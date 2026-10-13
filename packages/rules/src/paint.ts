import type { Box, ComputedStyle, MarloDocument, MarloElement } from './dom.js';
import { ancestors, attr, hasAttr, isHiddenFromAssistiveTech, normalise, walk } from './dom.js';
import type { Rgba } from './colour.js';
import {
  TRANSPARENT,
  WHITE,
  contrastRatio,
  formatColour,
  isLargeText,
  over,
  parseColour,
  parseFontSizePx,
  parseFontWeight,
  scaleAlpha,
} from './colour.js';

/**
 * The paint-order walk: what colour is a piece of text, and what colour is actually
 * behind it.
 *
 * The second question is the hard one. Backgrounds are transparent by default, so the
 * colour behind a paragraph may come from any ancestor; `opacity` on an ancestor fades
 * everything inside it, text included; a positioned sibling may paint between the text
 * and the box that looks like its background. This module walks the stack the way a
 * browser paints it, composites in gamma-encoded sRGB, and answers with a measured
 * pair of colours or with a reason it could not conclude, naming the element that made
 * the question undecidable.
 *
 * The reasons are not an apology. A confident wrong ratio is a page that ships broken
 * with a green check next to it, so every branch that would need a guess returns
 * `undecidable` and says what to look at instead. The walk refuses backgrounds that are
 * images or gradients, filters and blend modes, text shadows, colour spaces it does not
 * convert, missing geometry, and overlapping positioned elements with a background.
 *
 * Nothing here reads a style attribute. Every input is a computed value or a box, so
 * the rule using this module has to declare `layout`, and under the static renderer it
 * is refused before it can run.
 */

/** Why an element's text is, or is not, something the contrast rules apply to. */
export type ContrastApplicability =
  { readonly applicable: true } | { readonly applicable: false; readonly reason: string };

/** A resolved foreground and background pair, or the reason there is none. */
export type ContrastMeasurement =
  | {
      readonly kind: 'measured';
      readonly foreground: Rgba;
      readonly background: Rgba;
      readonly ratio: number;
      readonly fontSizePx: number;
      readonly fontWeight: number;
      readonly largeText: boolean;
      /** How transparency entered the result, when it did. Shown to the reader. */
      readonly notes: readonly string[];
    }
  | { readonly kind: 'undecidable'; readonly reason: string };

/** Elements whose descendant text is never rendered as page text. */
const NON_RENDERED_CONTAINERS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'title',
  'head',
  // Not HTML elements. SVG and MathML text has its own rendering and the ACT rule
  // scopes itself to text nodes whose parent is an HTML element.
  'svg',
  'math',
]);

/** Elements the `disabled` attribute actually disables. */
const DISABLEABLE = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'fieldset',
  'optgroup',
  'option',
]);

/** Elements a `label` can label, when it wraps one rather than pointing with `for`. */
const LABELABLE = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);

/** `tag#id`, `tag.first-class`, or `tag`: the element in the developer's own terms. */
export function describeElement(element: MarloElement): string {
  const id = attr(element, 'id');
  if (id !== null && id !== '') return `${element.tag}#${id}`;
  const firstClass = /\S+/.exec(attr(element, 'class') ?? '')?.[0];
  if (firstClass !== undefined) return `${element.tag}.${firstClass}`;
  return element.tag;
}

/**
 * Disabled in the ACT sense: the element or an ancestor carries a `disabled` attribute
 * that the HTML specification honours, or `aria-disabled="true"`, which the rule assumes
 * disables the element for every user.
 *
 * The one refinement HTML makes that this does not is the first `legend` of a disabled
 * `fieldset`, whose controls stay enabled. A label inside such a legend would be read as
 * disabled here and skipped, which is the cautious direction.
 */
function isDisabled(element: MarloElement): boolean {
  for (const node of [element, ...ancestors(element)]) {
    if (DISABLEABLE.has(node.tag) && hasAttr(node, 'disabled')) return true;
    if (attr(node, 'aria-disabled') === 'true') return true;
  }
  return false;
}

/**
 * Per-document facts that every target would otherwise recompute: elements by id,
 * `aria-labelledby` references, document order, and the positioned elements that could
 * paint over something. Built once per document root and held weakly, because a page
 * with two thousand text runs would otherwise walk the tree four thousand times.
 */
interface DocumentIndex {
  readonly byId: ReadonlyMap<string, MarloElement>;
  readonly labelledBy: ReadonlyMap<string, readonly MarloElement[]>;
  readonly order: ReadonlyMap<MarloElement, number>;
  readonly painters: readonly Painter[];
}

/**
 * Something that paints a background in a layer above normal flow: an element that is
 * positioned, transformed or floated, or any descendant of one, since a descendant
 * paints in its ancestor's layer whether or not it is positioned itself. A transparent
 * positioned wrapper with an opaque child is the common shape of a toast or a modal,
 * and the wrapper alone would look harmless.
 */
interface Painter {
  /** The element whose background paints. */
  readonly element: MarloElement;
  /** The positioned, transformed or floated element it paints inside, or itself. */
  readonly layer: MarloElement;
  readonly box: Box;
  /** The painted background, in the developer's terms. */
  readonly what: string;
  /** Whether the layer is a float rather than positioned or transformed. */
  readonly floated: boolean;
}

const INDEXES = new WeakMap<MarloElement, DocumentIndex>();

function indexOf(document: MarloDocument): DocumentIndex {
  const cached = INDEXES.get(document.root);
  if (cached !== undefined) return cached;

  const byId = new Map<string, MarloElement>();
  const labelledBy = new Map<string, MarloElement[]>();
  const order = new Map<MarloElement, number>();
  const painters: Painter[] = [];
  let position = 0;

  for (const element of walk(document.root)) {
    order.set(element, position);
    position += 1;

    const id = attr(element, 'id');
    if (id !== null && id !== '' && !byId.has(id)) byId.set(id, element);

    const references = attr(element, 'aria-labelledby');
    if (references !== null) {
      for (const token of normalise(references).split(' ')) {
        if (token === '') continue;
        const list = labelledBy.get(token) ?? [];
        list.push(element);
        labelledBy.set(token, list);
      }
    }

    // Every layer is recorded with all of its members, nested layers included, so text
    // inside one layer is still checked against a second layer nested in the first.
    const computed = element.computed;
    if (computed === null) continue;
    const positioned = read(computed, 'position', 'static') !== 'static';
    const transformed = read(computed, 'transform', 'none') !== 'none';
    const floated = read(computed, 'float', 'none') !== 'none';
    if (!positioned && !transformed && !floated) continue;
    for (const member of walk(element)) {
      const what = paintedBackground(member);
      if (what !== null && member.box !== null) {
        painters.push({
          element: member,
          layer: element,
          box: member.box,
          what,
          floated: !positioned && !transformed,
        });
      }
    }
  }

  const index: DocumentIndex = { byId, labelledBy, order, painters };
  INDEXES.set(document.root, index);
  return index;
}

/**
 * Whether the text is part of the label of a disabled widget: inside a `label` whose
 * control is disabled, or inside an element that a disabled element names through
 * `aria-labelledby`. The ACT rule exempts both, because a disabled control's label is
 * conventionally dimmed along with it.
 */
function labelsDisabledWidget(element: MarloElement, document: MarloDocument): boolean {
  const index = indexOf(document);
  for (const node of [element, ...ancestors(element)]) {
    if (node.tag === 'label') {
      const forId = attr(node, 'for');
      const control =
        forId !== null && forId !== ''
          ? (index.byId.get(forId) ?? null)
          : ([...walk(node)].find((d) => d !== node && LABELABLE.has(d.tag)) ?? null);
      if (control !== null && isDisabled(control)) return true;
    }
    const id = attr(node, 'id');
    if (id === null || id === '') continue;
    if (index.labelledBy.get(id)?.some(isDisabled) === true) return true;
  }
  return false;
}

/**
 * A computed property, or its initial value when the renderer did not supply one.
 *
 * A renderer that provides `layout` resolves every property, so the fallback is only
 * ever taken by a hand-built fixture that left a property out. `color` and `font-size`
 * are deliberately not read through this: neither has an initial value that is safe to
 * assume, and a fixture has to state them.
 */
function read(computed: ComputedStyle, property: string, initial: string): string {
  const value = computed.get(property);
  return value === null ? initial : value.trim().toLowerCase();
}

function parseOpacity(computed: ComputedStyle): number | null {
  const text = read(computed, 'opacity', '1');
  const value = text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

/** Whether the box lies entirely above or to the left of the document origin. */
function isOffDocument(box: Box, document: MarloDocument): boolean {
  if (box.y + box.height <= 0) return true;
  // Negative horizontal positions are reachable by scrolling in a right-to-left
  // document, so the horizontal test only applies when the document reads left to
  // right.
  const direction = document.root.computed?.get('direction') ?? 'ltr';
  return direction !== 'rtl' && box.x + box.width <= 0;
}

/**
 * Whether the contrast rules apply to an element's own text.
 *
 * Decided from the element's own text rather than its descendants' because colour and
 * size are per element: `<p>Hello <b>there</b></p>` is two targets, each measured in
 * its own styles. The exemptions follow the ACT rule: text with no letters conveys
 * nothing in a human language, text in a disabled widget or its label is exempt,
 * hidden text is exempt. Where the decision needs a computed style or a box and the
 * element has none, the element stays applicable and the measurement reports what was
 * missing, so a renderer gap is visible as `cantTell` rather than hidden as
 * inapplicable.
 */
export function contrastApplicability(
  element: MarloElement,
  document: MarloDocument,
): ContrastApplicability {
  const text = normalise(element.ownText);
  if (text === '') return { applicable: false, reason: 'The element has no text of its own.' };
  if (!/\p{L}/u.test(text)) {
    return {
      applicable: false,
      reason:
        'The text contains no letters, only punctuation, symbols or digits, so it does not ' +
        'express anything in a human language and the contrast rules exempt it.',
    };
  }

  const chain = [element, ...ancestors(element)];
  for (const node of chain) {
    if (NON_RENDERED_CONTAINERS.has(node.tag)) {
      return {
        applicable: false,
        reason: `The text is inside ${node.tag}, which does not render it as page text.`,
      };
    }
  }

  if (isHiddenFromAssistiveTech(element)) {
    return { applicable: false, reason: 'The text is hidden from assistive technology.' };
  }

  if (isDisabled(element)) {
    return { applicable: false, reason: 'The text is inside a disabled widget.' };
  }
  if (labelsDisabledWidget(element, document)) {
    return { applicable: false, reason: 'The text labels a disabled widget.' };
  }

  // `display: none` on the element or an ancestor is already covered above:
  // isHiddenFromAssistiveTech reads the computed display when there is one.
  for (const node of chain) {
    const computed = node.computed;
    if (computed !== null && parseOpacity(computed) === 0) {
      return { applicable: false, reason: `${describeElement(node)} has opacity 0.` };
    }
  }
  // `visibility` inherits and a descendant can set it back, so the element's own
  // computed value is the one that says whether its text is painted.
  const own = element.computed;
  if (own !== null && read(own, 'visibility', 'visible') !== 'visible') {
    return { applicable: false, reason: 'The text has visibility other than visible.' };
  }

  const box = element.box;
  if (box !== null) {
    if (box.width <= 0 || box.height <= 0) {
      return {
        applicable: false,
        reason: 'The element has a zero-area box, so nothing is painted.',
      };
    }
    if (isOffDocument(box, document)) {
      return {
        applicable: false,
        reason:
          'The element is positioned entirely outside the document, where nobody can scroll to it.',
      };
    }
  }

  return { applicable: true };
}

function undecidable(reason: string): ContrastMeasurement {
  return { kind: 'undecidable', reason };
}

function clip(value: string): string {
  return value.length <= 80 ? value : `${value.slice(0, 79)}…`;
}

/**
 * Resolves a colour property on a node, following `currentcolor` to the nearest `color`
 * that is not itself `currentcolor`. Returns the colour, or a reason it could not be
 * read.
 */
function resolveColour(
  node: MarloElement,
  property: string,
  initial: string,
): { colour: Rgba } | { reason: string } {
  const computed = node.computed;
  if (computed === null) {
    return { reason: `No resolved styles are available for ${describeElement(node)}.` };
  }
  const raw = read(computed, property, initial);
  const parsed = parseColour(raw);
  if (parsed.kind === 'colour') return { colour: parsed.value };
  if (parsed.kind === 'unsupported') {
    return {
      reason:
        `The ${property} of ${describeElement(node)} is ${clip(raw)}, which is in a colour space ` +
        'Marlo does not convert. Express it in rgb, hex or hsl to get a ratio, or check the ' +
        'rendered page.',
    };
  }
  // currentcolor: the element's own color, or the inherited one when the property is
  // color itself.
  const source = property === 'color' ? node.parent : node;
  if (source === null) {
    return {
      reason:
        `The color of ${describeElement(node)} is currentcolor with no ancestor to inherit ` +
        'from, so the text colour is unknown.',
    };
  }
  return resolveColour(source, 'color', 'currentcolor');
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * The background an element paints, or null when it paints none. A colour that does
 * not parse counts as painting, because it cannot be shown to be transparent.
 */
function paintedBackground(element: MarloElement): string | null {
  const computed = element.computed;
  if (computed === null) return null;
  const image = read(computed, 'background-image', 'none');
  if (image !== 'none') return `background-image ${clip(image)}`;
  const text = read(computed, 'background-color', 'transparent');
  const colour = parseColour(text);
  if (colour.kind === 'colour' && colour.value.a === 0) return null;
  return `background-color ${clip(text)}`;
}

/**
 * The first background painted in a layer above normal flow that overlaps the text's
 * box and does not belong to one of its ancestors: it may sit between the text and
 * whatever the ancestor walk took for the background.
 */
function findOverlappingPainter(
  element: MarloElement,
  box: Box,
  document: MarloDocument,
): Painter | null {
  const index = indexOf(document);
  const excluded = new Set<MarloElement>([element, ...ancestors(element)]);
  const own = index.order.get(element) ?? 0;
  for (const painter of index.painters) {
    if (excluded.has(painter.layer)) continue;
    // A float earlier in the document has already been flowed around; one later may
    // be pulled up over this text.
    if (painter.floated && (index.order.get(painter.layer) ?? 0) < own) continue;
    if (overlaps(painter.box, box)) return painter;
  }
  return null;
}

/** Properties that change painted pixels after compositing, with their initial values. */
const POST_COMPOSITING = [
  ['mix-blend-mode', 'normal'],
  ['filter', 'none'],
  ['backdrop-filter', 'none'],
] as const;

/**
 * Measures the contrast of an element's own text.
 *
 * The stack is built from the element upward. At each level the node's
 * `background-color` is composited under both the text and the running background,
 * and the node's `opacity` is then applied to both, because opacity fades the whole
 * group including the text. Once the running background is opaque, outer backgrounds
 * cannot show through and are skipped, until an outer `opacity` below one makes them
 * matter again. The canvas under everything is white, and the walk declines when a
 * `color-scheme` lets the browser paint it dark. A `background-color` on `html`, or on
 * `body` when `html` has none, propagates to the canvas, and both of those are
 * ancestors, so the propagation changes nothing the walk has not already composited.
 *
 * The result is the text colour composited over the stack, the stack composited
 * without the text, and the WCAG ratio between them.
 */
export function measureContrast(
  element: MarloElement,
  document: MarloDocument,
): ContrastMeasurement {
  const computed = element.computed;
  if (computed === null) {
    return undecidable(
      `No resolved styles are available for ${describeElement(element)}, so its colours are unknown.`,
    );
  }
  const box = element.box;
  if (box === null) {
    return undecidable(
      `No geometry is available for ${describeElement(element)}, so Marlo cannot tell whether ` +
        'anything paints over its text.',
    );
  }

  const fontSizeText = computed.get('font-size');
  const fontSizePx = fontSizeText === null ? null : parseFontSizePx(fontSizeText);
  if (fontSizePx === null) {
    return undecidable(
      `The font-size of ${describeElement(element)} is ${fontSizeText ?? 'missing'}, which is ` +
        'not a pixel value, so the large-text threshold cannot be chosen.',
    );
  }
  const fontWeightText = read(computed, 'font-weight', '400');
  const fontWeight = parseFontWeight(fontWeightText);
  if (fontWeight === null) {
    return undecidable(
      `The font-weight of ${describeElement(element)} is ${fontWeightText}, which is not a ` +
        'weight Marlo can read, so the large-text threshold cannot be chosen.',
    );
  }

  const shadow = read(computed, 'text-shadow', 'none');
  if (shadow !== 'none') {
    return undecidable(
      `This text has text-shadow ${clip(shadow)}. A shadow can raise or lower the effective ` +
        'contrast and needs a human judgement; check the rendered text.',
    );
  }
  const stroke = read(computed, '-webkit-text-stroke-width', '0px');
  if (!/^0(?:\.0+)?(?:px)?$/.test(stroke)) {
    return undecidable(
      `This text has a text stroke of ${clip(stroke)}, which paints a second colour over the ` +
        'glyphs; check the rendered text.',
    );
  }

  const textColour = resolveColour(element, 'color', 'currentcolor');
  if ('reason' in textColour) return undecidable(textColour.reason);

  const fill = computed.get('-webkit-text-fill-color');
  if (fill !== null) {
    const parsedFill = parseColour(fill);
    const differs =
      parsedFill.kind === 'unsupported' ||
      (parsedFill.kind === 'colour' && !sameColour(parsedFill.value, textColour.colour));
    if (differs) {
      return undecidable(
        `This text is painted with -webkit-text-fill-color ${clip(fill)} rather than its color, ` +
          'and Marlo does not resolve the fill colour; check the rendered text.',
      );
    }
  }

  const painter = findOverlappingPainter(element, box, document);
  if (painter !== null) {
    const who =
      painter.element === painter.layer
        ? describeElement(painter.element)
        : `${describeElement(painter.element)}, inside ${describeElement(painter.layer)},`;
    return undecidable(
      `${who} is positioned over this text with ${painter.what}, so it may paint between ` +
        'the text and the background Marlo resolved. Check what is actually behind the text.',
    );
  }

  const notes: string[] = [];
  if (textColour.colour.a < 1) {
    notes.push(`The text colour ${formatColour(textColour.colour)} is translucent.`);
  }

  let foreground = textColour.colour;
  let background: Rgba = TRANSPARENT;
  let sealed = false;

  for (const node of [element, ...ancestors(element)]) {
    const styles = node.computed;
    if (styles === null) {
      return undecidable(
        `No resolved styles are available for ${describeElement(node)}, which is behind this text.`,
      );
    }
    for (const [property, initial] of POST_COMPOSITING) {
      const value = read(styles, property, initial);
      if (value !== initial) {
        return undecidable(
          `${describeElement(node)} has ${property}: ${clip(value)}, which changes the painted ` +
            'colours after compositing in a way Marlo does not compute. Check the rendered page.',
        );
      }
    }

    if (!sealed) {
      const image = read(styles, 'background-image', 'none');
      if (image !== 'none') {
        const gradient = image.includes('gradient');
        return undecidable(
          `${describeElement(node)} has a ${gradient ? 'gradient' : 'background image'} ` +
            `(${clip(image)}) behind this text, so there is no single background colour. ` +
            (gradient
              ? 'Check the ratio at the lightest and the darkest point behind the text.'
              : 'Check the ratio against the image where the text sits.'),
        );
      }
      const layer = resolveColour(node, 'background-color', 'transparent');
      if ('reason' in layer) return undecidable(layer.reason);
      foreground = over(foreground, layer.colour);
      background = over(background, layer.colour);
      if (layer.colour.a > 0 && layer.colour.a < 1) {
        notes.push(
          `The background of ${describeElement(node)}, ${formatColour(layer.colour)}, is translucent.`,
        );
      }
      if (background.a >= 1) sealed = true;
    }

    const opacity = parseOpacity(styles);
    if (opacity === null) {
      return undecidable(
        `The opacity of ${describeElement(node)} is ${read(styles, 'opacity', '1')}, which ` +
          'Marlo cannot read.',
      );
    }
    if (opacity < 1) {
      foreground = scaleAlpha(foreground, opacity);
      background = scaleAlpha(background, opacity);
      sealed = false;
      notes.push(`${describeElement(node)} has opacity ${opacity}, which fades the text with it.`);
    }
  }

  if (background.a < 1) {
    const scheme = darkCanvasSource(document);
    if (scheme !== null) {
      return undecidable(
        `Nothing behind this text is opaque, so the canvas shows through, and ${scheme} lets ` +
          'the browser paint the canvas dark when the reader prefers a dark scheme. The ' +
          'background depends on that preference; give the page an explicit background colour.',
      );
    }
  }

  foreground = over(foreground, WHITE);
  background = over(background, WHITE);

  return {
    kind: 'measured',
    foreground,
    background,
    ratio: contrastRatio(foreground, background),
    fontSizePx,
    fontWeight,
    largeText: isLargeText(fontSizePx, fontWeight),
    notes,
  };
}

/** Colour schemes under which the canvas is white whatever the reader prefers. */
const LIGHT_SCHEMES = new Set(['normal', 'light', 'only light']);

/**
 * What allows the canvas to be dark: a `color-scheme` on the root element, or a
 * `<meta name="color-scheme">`, that admits `dark`. Null when the canvas is white.
 */
function darkCanvasSource(document: MarloDocument): string | null {
  const root = document.root;
  const computed = root.computed;
  if (computed !== null) {
    const scheme = normalise(read(computed, 'color-scheme', 'normal'));
    if (!LIGHT_SCHEMES.has(scheme)) return `color-scheme: ${clip(scheme)} on ${root.tag}`;
  }
  for (const element of walk(root)) {
    if (element.tag !== 'meta' || attr(element, 'name')?.toLowerCase() !== 'color-scheme') continue;
    const content = normalise(attr(element, 'content') ?? '').toLowerCase();
    if (content !== '' && !LIGHT_SCHEMES.has(content)) {
      return `<meta name="color-scheme" content="${clip(content)}">`;
    }
  }
  return null;
}

function sameColour(a: Rgba, b: Rgba): boolean {
  return formatColour(a) === formatColour(b);
}
