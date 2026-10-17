import type { Box, ComputedStyle, MarloAttribute, MarloDocument, MarloElement } from './dom.js';

/**
 * Builds the pure DOM view from a renderer's own DOM.
 *
 * The input is described structurally rather than by importing a DOM library, because
 * @trymarlo/rules is pure and a dependency rule forbids it from reaching for happy-dom.
 * The caller passes an object with the three methods this needs, which every DOM
 * implementation has.
 *
 * `range` is null here, always. Byte ranges come from the source parser in
 * @trymarlo/repair, which parses the original bytes rather than a serialised tree: a
 * serialisation has already normalised attribute quoting and self-closing tags, so
 * offsets taken from it would not describe the file a fix has to edit.
 */

/** The shape any DOM element satisfies. */
export interface SourceElement {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly childNodes: ArrayLike<SourceElement>;
  readonly attributes?: ArrayLike<{ readonly name: string; readonly value: string }>;
  readonly textContent: string | null;
  readonly outerHTML?: string;
  /** An open shadow root, when the element hosts one. Closed roots read as null. */
  readonly shadowRoot?: unknown;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export interface ParseOptions {
  readonly url: string;
  readonly hasDoctype: boolean;
  /**
   * Resolved styles for an element, or null when the renderer provides no layout.
   *
   * Passing null rather than a function that returns declared values is deliberate: a
   * declared value dressed up as a computed one is how a contrast rule produces a
   * number that does not describe what a user sees.
   */
  readonly computedStyleFor: ((element: SourceElement) => ComputedStyle) | null;
  /**
   * The border box of an element, or null when the renderer provides no layout.
   *
   * Same rule as `computedStyleFor`. A box has to come from a renderer that laid the
   * page out; anything else is a guess about geometry wearing the type of a measurement.
   */
  readonly boxFor: ((element: SourceElement) => Box | null) | null;
}

interface Mutable {
  tag: string;
  attributes: MarloAttribute[];
  children: MarloElement[];
  parent: MarloElement | null;
  text: string;
  ownText: string;
  range: null;
  outerHTML: string;
  computed: ComputedStyle | null;
  box: Box | null;
}

function convert(
  source: SourceElement,
  parent: MarloElement | null,
  options: ParseOptions,
  counts: { shadowRoots: number },
): MarloElement {
  if (typeof source.shadowRoot === 'object' && source.shadowRoot !== null) counts.shadowRoots += 1;
  const node: Mutable = {
    tag: source.nodeName.toLowerCase(),
    attributes: [],
    children: [],
    parent,
    text: '',
    ownText: '',
    range: null,
    outerHTML: source.outerHTML ?? '',
    computed: options.computedStyleFor === null ? null : options.computedStyleFor(source),
    box: options.boxFor === null ? null : options.boxFor(source),
  };

  // Array.from rather than an index loop, because a DOM NamedNodeMap and NodeList are
  // array-like rather than arrays and the linter prefers for-of over index arithmetic.
  for (const attribute of Array.from(source.attributes ?? [])) {
    node.attributes.push({
      name: attribute.name.toLowerCase(),
      value: attribute.value,
      range: null,
    });
  }

  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      node.ownText += child.textContent ?? '';
      continue;
    }
    if (child.nodeType !== ELEMENT_NODE) continue;
    node.children.push(convert(child, node, options, counts));
  }

  node.text = source.textContent ?? '';
  return node;
}

export function buildDocument(root: SourceElement, options: ParseOptions): MarloDocument {
  const counts = { shadowRoots: 0 };
  const converted = convert(root, null, options, counts);
  return {
    root: converted,
    url: options.url,
    hasDoctype: options.hasDoctype,
    shadowRoots: counts.shadowRoots,
  };
}
