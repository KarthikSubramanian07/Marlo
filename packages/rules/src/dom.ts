/**
 * A structural DOM view, hand-written.
 *
 * @trymarlo/rules is a pure package: no filesystem, no network, no DOM library. A rule is
 * a function over these interfaces, which means it can be run against a fixture built
 * by hand in a test without a renderer anywhere. That is what makes the contribution
 * path "one rule, one function, one fixture set" true rather than aspirational.
 *
 * It also means a rule cannot reach for a browser API that only one renderer provides.
 * If a rule needs a computed style it has to ask through `ComputedStyle`, which is
 * `null` unless the renderer supplied `layout`, and the capability model refuses the
 * rule rather than letting it read a value that does not describe what a user sees.
 */

export interface MarloElement {
  /** Lower-case tag name. Normalised on construction so rules need not remember. */
  readonly tag: string;
  /** Attributes with lower-case names, in document order. Duplicates preserved. */
  readonly attributes: readonly MarloAttribute[];
  readonly children: readonly MarloElement[];
  readonly parent: MarloElement | null;
  /** Concatenated descendant text, in document order. */
  readonly text: string;
  /**
   * The element's own text: its direct text node children, concatenated in order, with
   * no descendant element text. `<p>Hello <b>there</b></p>` gives `Hello ` for the
   * paragraph and `there` for the bold. A rule about rendered text needs this rather
   * than `text`, because the colour and size of a child are the child's.
   */
  readonly ownText: string;
  /** Byte range in the original source, if the parser recorded one. */
  readonly range: { readonly start: number; readonly end: number } | null;
  /** Serialised form, for evidence in a report. */
  readonly outerHTML: string;
  /**
   * Resolved styles, or null when the renderer provided no `layout` capability.
   *
   * Null rather than an empty object, so a rule reading it has to handle the absence
   * and cannot accidentally treat "no layout" as "no styles set".
   */
  readonly computed: ComputedStyle | null;
  /**
   * The element's border box in CSS pixels, in document coordinates, or null when the
   * renderer provided no `layout` capability.
   *
   * Null for the same reason `computed` is: a rule that needs to know whether two
   * elements overlap has to handle not knowing, and cannot read a zero-sized box as an
   * element that is not there.
   */
  readonly box: Box | null;
}

/** A rectangle in CSS pixels. Document coordinates, so scrolling does not move it. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MarloAttribute {
  readonly name: string;
  readonly value: string;
  /** Byte range of the whole `name="value"` construct, for surgical edits. */
  readonly range: { readonly start: number; readonly end: number } | null;
}

export interface ComputedStyle {
  get(property: string): string | null;
}

/** The document, plus the facts rules need that are not in the tree. */
export interface MarloDocument {
  readonly root: MarloElement;
  /** The URL the document believes it is at. Same-page link rules need it. */
  readonly url: string;
  /** Whether the source declared a doctype. Some rules scope to HTML documents. */
  readonly hasDoctype: boolean;
  /**
   * How many shadow roots the renderer's document holds, none of which this view enters.
   *
   * IDs and ID references are scoped to the tree they are written in, so folding a shadow
   * tree into the light one would invent duplicate ids and resolve references across a
   * boundary the browser does not. The view leaves shadow content out instead, and says
   * how much it left out, so a rule can decline rather than call a page it could not see
   * clean. See `evaluateRules`.
   */
  readonly shadowRoots: number;
}

export function attr(element: MarloElement, name: string): string | null {
  const lower = name.toLowerCase();
  for (const a of element.attributes) if (a.name === lower) return a.value;
  return null;
}

export function hasAttr(element: MarloElement, name: string): boolean {
  return attr(element, name) !== null;
}

export function attrNode(element: MarloElement, name: string): MarloAttribute | null {
  const lower = name.toLowerCase();
  for (const a of element.attributes) if (a.name === lower) return a;
  return null;
}

/** Depth-first, document order, including the starting element. */
export function* walk(element: MarloElement): Generator<MarloElement> {
  yield element;
  for (const child of element.children) yield* walk(child);
}

export function descendants(element: MarloElement): MarloElement[] {
  return [...walk(element)].slice(1);
}

export function ancestors(element: MarloElement): MarloElement[] {
  const out: MarloElement[] = [];
  let current = element.parent;
  while (current !== null) {
    out.push(current);
    current = current.parent;
  }
  return out;
}

export function findAll(document: MarloDocument, tags: readonly string[]): MarloElement[] {
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  return [...walk(document.root)].filter((e) => wanted.has(e.tag));
}

export function findFirst(document: MarloDocument, tag: string): MarloElement | null {
  const lower = tag.toLowerCase();
  for (const element of walk(document.root)) if (element.tag === lower) return element;
  return null;
}

/**
 * Whether an element is hidden from assistive technology.
 *
 * Deliberately conservative and deliberately incomplete. It covers what is decidable
 * from the DOM alone: `hidden`, `aria-hidden="true"`, `display:none` or
 * `visibility:hidden` in a style attribute, an ancestor with any of those, and the
 * `<template>` and `<head>` subtrees. Where the renderer resolved styles it also reads
 * the resolved `display` of the element and its ancestors and the resolved `visibility`
 * of the element, which only ever takes an element out (D-016).
 *
 * What it cannot see is a class in a stylesheet that hides the element. That is a
 * `layout` question, and a rule whose correctness depends on it must declare `layout`
 * rather than relying on this. Getting that wrong produces a false positive on an
 * element nobody can reach, which is the most annoying kind of false positive because
 * the developer looks at the page and sees nothing wrong.
 */
export function isHiddenFromAssistiveTech(element: MarloElement): boolean {
  // ACT's "programmatically hidden" includes a computed visibility other than visible.
  // Visibility inherits, so the element's own resolved value already reflects its
  // ancestors, and a descendant set back to visible is not hidden by this test.
  const visibility = resolved(element, 'visibility');
  if (visibility !== null && visibility !== 'visible') return true;
  for (const node of [element, ...ancestors(element)]) {
    if (node.tag === 'template' || node.tag === 'head') return true;
    if (hasAttr(node, 'hidden')) return true;
    if (attr(node, 'aria-hidden') === 'true') return true;
    const style = attr(node, 'style');
    if (
      style !== null &&
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/i.test(style)
    ) {
      return true;
    }
    const computed = node.computed?.get('display');
    if (computed === 'none') return true;
  }
  return false;
}

/**
 * Hidden from sight, as far as the DOM can tell: the `hidden` attribute, or
 * `display: none` or `visibility: hidden` in a style attribute, on the element or an
 * ancestor. `aria-hidden` is deliberately not part of this. It hides from assistive
 * technology and leaves the pixels alone, so a rule that cares about both asks about
 * them separately.
 *
 * Like `isHiddenFromAssistiveTech`, it cannot see a stylesheet. A rule using it says
 * so in its own comment, and the direction of the gap is a hidden element read as
 * shown.
 */
export function isVisuallyHidden(element: MarloElement): boolean {
  for (const node of [element, ...ancestors(element)]) {
    if (hasAttr(node, 'hidden')) return true;
    const style = attr(node, 'style');
    if (style === null) continue;
    // `display: none` removes the subtree and no descendant can undo it.
    if (/(?:^|;)\s*display\s*:\s*none\s*(?:!\s*important)?\s*(?:;|$)/i.test(style)) return true;
    // `visibility` inherits and a descendant may set it back to `visible`, so the
    // nearest declaration wins rather than the first hidden one found on the way up.
    const visibility = /(?:^|;)\s*visibility\s*:\s*([a-z]+)/i.exec(style);
    if (visibility !== null) return visibility[1]?.toLowerCase() !== 'visible';
  }
  return false;
}

const INLINE_DISPLAY_NONE = /(?:^|;)\s*display\s*:\s*none\s*(?:!\s*important)?\s*(?:;|$)/i;

/** A resolved style value, or null where the renderer resolved none. */
function resolved(element: MarloElement, property: string): string | null {
  const value = element.computed?.get(property) ?? null;
  return value === null || value.trim() === '' ? null : value.trim().toLowerCase();
}

/**
 * Whether an element is not rendered: it or an ancestor generates no box, or it sits in
 * a closed `details` element anywhere but that element's summary.
 *
 * Where the renderer resolved styles, `display` is read from them, so a class in a
 * stylesheet counts the same as an inline style, and `[hidden]` overridden by CSS
 * counts as shown. Where it did not, the `hidden` attribute and an inline
 * `display: none` are the only evidence, which is the static renderer's best available
 * signal.
 *
 * The direction of that gap matters to every caller. An element a stylesheet hides
 * reads as rendered on the static renderer, so a rule that drops unrendered elements
 * from scope keeps that element in scope there. It over-applies, and whatever it
 * reports names an element a reader can check. It never turns into a pass nobody can
 * see, which is why a rule using this needs only `dom`: it reads `layout` when it is
 * there and does not depend on it.
 */
export function isNotRendered(element: MarloElement): boolean {
  let below: MarloElement | null = null;
  for (const node of [element, ...ancestors(element)]) {
    if (node.tag === 'template' || node.tag === 'head') return true;
    const display = resolved(node, 'display');
    if (display !== null) {
      if (display === 'none') return true;
    } else if (
      hasAttr(node, 'hidden') ||
      INLINE_DISPLAY_NONE.test(attr(node, 'style') ?? '') ||
      (node.tag === 'input' && (attr(node, 'type') ?? '').toLowerCase() === 'hidden')
    ) {
      return true;
    }
    // A closed details element renders its first summary and nothing else.
    if (node.tag === 'details' && below !== null && !hasAttr(node, 'open')) {
      if (below !== node.children.find((c) => c.tag === 'summary')) return true;
    }
    below = node;
  }
  return false;
}

/**
 * Whether `visibility` hides an element. It inherits and a descendant may set it back to
 * `visible`, so the resolved value on the element itself decides where styles were
 * resolved, and otherwise the nearest inline declaration on the way up does.
 */
export function isVisibilityHidden(element: MarloElement): boolean {
  const own = resolved(element, 'visibility');
  if (own !== null) return own !== 'visible';
  for (const node of [element, ...ancestors(element)]) {
    const visibility = /(?:^|;)\s*visibility\s*:\s*([a-z]+)/i.exec(attr(node, 'style') ?? '');
    if (visibility !== null) return visibility[1]?.toLowerCase() !== 'visible';
  }
  return false;
}

const FORM_CONTROLS: ReadonlySet<string> = new Set(['button', 'input', 'select', 'textarea']);

/**
 * Whether a form control is disabled, by its own attribute or by a disabled `fieldset`
 * around it. A control inside that fieldset's first `legend` stays enabled, as HTML
 * specifies.
 */
function isDisabledControl(element: MarloElement): boolean {
  if (!FORM_CONTROLS.has(element.tag)) return false;
  if (hasAttr(element, 'disabled')) return true;
  let below: MarloElement = element;
  for (const node of ancestors(element)) {
    if (node.tag === 'fieldset' && hasAttr(node, 'disabled')) {
      const legend = node.children.find((c) => c.tag === 'legend');
      if (legend === undefined || below !== legend) return true;
    }
    below = node;
  }
  return false;
}

/**
 * Whether an element is part of sequential focus navigation: focusable by default or by
 * a non-negative tabindex, and not removed from the order by being unrendered, hidden by
 * `visibility`, inert, or disabled. The stylesheet caveat on `isNotRendered` applies.
 */
export function isInSequentialFocusOrder(element: MarloElement): boolean {
  if (!isFocusable(element) || isDisabledControl(element)) return false;
  if (isNotRendered(element) || isVisibilityHidden(element)) return false;
  return ![element, ...ancestors(element)].some((node) => hasAttr(node, 'inert'));
}

/** Focusable by default, or made focusable by a non-negative tabindex. */
export function isFocusable(element: MarloElement): boolean {
  const tabindex = attr(element, 'tabindex');
  if (tabindex !== null) {
    const parsed = Number.parseInt(tabindex, 10);
    if (!Number.isNaN(parsed)) return parsed >= 0;
  }
  if (hasAttr(element, 'disabled')) return false;
  switch (element.tag) {
    case 'a':
    case 'area':
      return hasAttr(element, 'href');
    case 'button':
    case 'input':
    case 'select':
    case 'textarea':
    case 'summary':
      return true;
    case 'audio':
    case 'video':
      return hasAttr(element, 'controls');
    default:
      return false;
  }
}

/** Normalises whitespace the way accessible name computation requires. */
export function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
