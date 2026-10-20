import type { MarloDocument, MarloElement } from './dom.js';
import { ancestors, attr, isHiddenFromAssistiveTech, normalise, walk } from './dom.js';

/**
 * Accessible name computation, for the subset of HTML-AAM the implemented rules need.
 *
 * WHAT THIS IS NOT.
 *
 * It is not a complete implementation of the Accessible Name and Description
 * Computation. A complete one handles CSS generated content, `::before` and `::after`,
 * table captions resolved through layout, and text alternatives that depend on the
 * rendered box tree. Those need `layout` and this package is pure.
 *
 * So this returns a name **and a confidence**. `certain` means every input to the
 * computation was in the DOM. `uncertain` means something outside the DOM could change
 * the answer, and a rule receiving `uncertain` must return `cantTell` rather than a
 * verdict. That is what keeps an incomplete accname from producing confident wrong
 * findings, and it is why Marlo's recall on the naming rules will be lower than a
 * browser-backed engine's. The calibration table publishes that cost rather than
 * hiding it.
 *
 * Order follows HTML-AAM: aria-labelledby, aria-label, the element's own native
 * mechanism, then title, and for a text field the placeholder as a last resort.
 */

export type NameConfidence = 'certain' | 'uncertain';

export interface AccessibleName {
  readonly name: string;
  readonly confidence: NameConfidence;
  /** Which step produced it. Reported so a fix knows what to change. */
  readonly from:
    | 'aria-labelledby'
    | 'aria-label'
    | 'native'
    | 'content'
    | 'title'
    | 'value'
    | 'placeholder'
    | 'none';
  /** Why the answer is uncertain, when it is. Shown to the reader. */
  readonly reason: string | null;
}

const NONE: AccessibleName = { name: '', confidence: 'certain', from: 'none', reason: null };

function byId(document: MarloDocument, id: string): MarloElement | null {
  for (const element of walk(document.root)) {
    if (attr(element, 'id') === id) return element;
  }
  return null;
}

/** Elements whose text is never rendered as content, though `textContent` includes it. */
const NO_TEXT: ReadonlySet<string> = new Set(['script', 'style', 'template', 'noscript']);

/**
 * Hidden by markup alone: `aria-hidden="true"`, the `hidden` attribute, or an inline
 * `display: none` or `visibility: hidden` on the element itself, whose subtree then adds
 * nothing to a name.
 *
 * Resolved styles are deliberately not read here. CSS generated content can name an
 * element whose only text a stylesheet hides, a citation backlink with a `::before`
 * counter for one, and no renderer here reports generated content. Reading a resolved
 * `display: none` would turn that link's name into an empty one in a browser, which is a
 * finding against a named link. So the name is computed from the markup in both
 * renderers, and stylesheet-hidden text counts as before.
 */
function hiddenByMarkup(node: MarloElement): boolean {
  if (attr(node, 'aria-hidden') === 'true' || attr(node, 'hidden') !== null) return true;
  return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!\s*important)?\s*(?:;|$)/i.test(
    attr(node, 'style') ?? '',
  );
}

const IMAGE_UNSETTLED =
  'An svg in the content holds text elements, and whether a browser adds them to the name ' +
  'differs between browsers.';
const FIGURE_UNSETTLED =
  'An image with no alt or title sits in a figure, and HTML-AAM may name it from the ' +
  'figcaption, which depends on the rest of the figure.';
const DESCENDANT_LABEL =
  'A descendant carries aria-label or aria-labelledby, so the name depends on a ' +
  'recursive computation this implementation does not perform.';

/**
 * The text an embedded `img` or `svg` adds to its ancestor's name, from accname 1.2,
 * HTML-AAM and SVG-AAM: aria-labelledby, aria-label, then the `alt` or `title` of an img,
 * or the `title` child of an svg. An image with none of them adds nothing, which is a
 * fact about the markup rather than a guess. A reason instead of text where the answer
 * is not settled.
 */
function imageText(node: MarloElement, document: MarloDocument): string | { reason: string } {
  // Accname step 2B uses the ids that resolve and skips the step when none does.
  const targets = normalise(attr(node, 'aria-labelledby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => byId(document, id))
    .filter((target) => target !== null);
  const joined = normalise(targets.map((t) => normalise(t.text)).join(' '));
  if (joined !== '') return joined;
  const label = normalise(attr(node, 'aria-label') ?? '');
  if (label !== '') return label;
  if (node.tag === 'img') {
    const role = normalise(attr(node, 'role') ?? '').toLowerCase();
    if (role === 'none' || role === 'presentation') return '';
    const alt = attr(node, 'alt') ?? attr(node, 'title');
    if (alt !== null) return normalise(alt);
    // HTML-AAM 4.1.10 names an img with neither from a figcaption in some figures.
    const inFigure = ancestors(node).some(
      (a) => a.tag === 'figure' && a.children.some((c) => c.tag === 'figcaption'),
    );
    return inFigure ? { reason: FIGURE_UNSETTLED } : '';
  }
  const title = node.children.find((c) => c.tag === 'title');
  if (title !== undefined && normalise(title.text) !== '') return normalise(title.text);
  const drawnText = [...walk(node)].some((n) => n.tag === 'text' && normalise(n.text) !== '');
  return drawnText ? { reason: IMAGE_UNSETTLED } : '';
}

/**
 * The content of an element, as name from content computes it: text in document order,
 * the text alternative of each image, nothing from a subtree hidden by markup or from
 * script and style. A descendant with its own aria-label or aria-labelledby is the case
 * still declined, because its contribution needs the full recursive computation.
 *
 * An element with no text of its own, such as an image, cannot be placed among the text
 * nodes around it, because the view keeps text only per element. Where such an element
 * adds words beside text, the words are right and their order may not be, which `doubt`
 * says.
 */
function contentText(
  node: MarloElement,
  document: MarloDocument,
): { readonly text: string; readonly doubt: string | null } | { readonly reason: string } {
  let out = '';
  let cursor = 0;
  let doubt: string | null = null;
  const ownText = node.ownText.trim() !== '';
  for (const child of node.children) {
    const at = node.text.indexOf(child.text, cursor);
    if (at === -1) return { reason: 'Marlo could not put the text of this content in order.' };
    let inner: string | { readonly reason: string };
    if (NO_TEXT.has(child.tag) || hiddenByMarkup(child)) inner = '';
    else if (child.tag === 'img' || child.tag === 'svg') inner = imageText(child, document);
    else if (attr(child, 'aria-label') !== null || attr(child, 'aria-labelledby') !== null) {
      inner = { reason: DESCENDANT_LABEL };
    } else {
      const nested = contentText(child, document);
      if ('reason' in nested) return nested;
      doubt ??= nested.doubt;
      inner = nested.text;
    }
    if (typeof inner !== 'string') return inner;
    if (child.text === '' && normalise(inner) !== '' && ownText) {
      doubt ??=
        'An image adds words beside text, and the order of the two is not recorded, so the ' +
        'words of the name are known and their order is not.';
    }
    out += `${node.text.slice(cursor, at)} ${inner} `;
    cursor = at + child.text.length;
  }
  return { text: out + node.text.slice(cursor), doubt };
}

/**
 * Text content of an element for naming purposes.
 *
 * `uncertain` when a descendant carries `aria-label` or `aria-labelledby`, because the
 * real computation would recurse into those and this does not, when an image's
 * contribution is not settled, or when the order of its words is not. CSS generated
 * content is not seen at all: see `hiddenByMarkup`.
 */
function contentName(element: MarloElement, document: MarloDocument): AccessibleName {
  const computed = contentText(element, document);
  if ('reason' in computed) {
    return {
      name: normalise(element.text),
      confidence: 'uncertain',
      from: 'content',
      reason: computed.reason,
    };
  }
  const text = normalise(computed.text);
  if (text === '') return { ...NONE, from: 'content' };
  return computed.doubt === null
    ? { name: text, confidence: 'certain', from: 'content', reason: null }
    : { name: text, confidence: 'uncertain', from: 'content', reason: computed.doubt };
}

/** The native naming mechanism for elements that have one. */
function nativeName(element: MarloElement, document: MarloDocument): AccessibleName | null {
  switch (element.tag) {
    case 'img':
    case 'area': {
      const alt = attr(element, 'alt');
      if (alt !== null) {
        return { name: normalise(alt), confidence: 'certain', from: 'native', reason: null };
      }
      return null;
    }

    case 'input': {
      const type = (attr(element, 'type') ?? 'text').toLowerCase();
      if (type === 'image') {
        const alt = attr(element, 'alt');
        if (alt !== null && normalise(alt) !== '') {
          return { name: normalise(alt), confidence: 'certain', from: 'native', reason: null };
        }
        return null;
      }
      if (type === 'submit' || type === 'reset' || type === 'button') {
        const value = attr(element, 'value');
        if (value !== null && normalise(value) !== '') {
          return { name: normalise(value), confidence: 'certain', from: 'value', reason: null };
        }
        // A submit or reset input with no value gets a browser-supplied default
        // ("Submit", "Reset"), which is locale-dependent and not in the DOM.
        if (type !== 'button') {
          return {
            name: '',
            confidence: 'uncertain',
            from: 'value',
            reason:
              `An input of type ${type} with no value attribute is given a default label by ` +
              'the browser, which is locale-dependent and not visible in the DOM.',
          };
        }
        return null;
      }
      return labelName(element, document);
    }

    case 'select':
    case 'textarea':
    case 'meter':
    case 'progress':
    case 'output':
      return labelName(element, document);

    case 'fieldset': {
      const legend = element.children.find((c) => c.tag === 'legend');
      if (legend !== undefined) return contentName(legend, document);
      return null;
    }

    case 'table': {
      const caption = element.children.find((c) => c.tag === 'caption');
      if (caption !== undefined) return contentName(caption, document);
      return null;
    }

    case 'iframe':
    case 'frame':
      // Named only by title, aria-label or aria-labelledby, all handled elsewhere.
      return null;

    default:
      return null;
  }
}

/** Input types HTML-AAM 4.1.1 names from a placeholder. */
const PLACEHOLDER_TYPES: ReadonlySet<string> = new Set([
  'text',
  'password',
  'number',
  'search',
  'tel',
  'email',
  'url',
]);

/** Every input type HTML defines. Any other value is the Text state. */
const INPUT_TYPES: ReadonlySet<string> = new Set([
  ...PLACEHOLDER_TYPES,
  'hidden',
  'date',
  'month',
  'week',
  'time',
  'datetime-local',
  'range',
  'color',
  'checkbox',
  'radio',
  'file',
  'submit',
  'image',
  'reset',
  'button',
]);

/** Whether HTML-AAM lets the element take its name from a placeholder. */
function takesPlaceholderName(element: MarloElement): boolean {
  if (element.tag === 'textarea') return true;
  if (element.tag !== 'input') return false;
  const type = normalise(attr(element, 'type') ?? '').toLowerCase();
  return PLACEHOLDER_TYPES.has(type) || !INPUT_TYPES.has(type);
}

/** A form control's name from a `label`, either wrapping or by `for`. */
function labelName(element: MarloElement, document: MarloDocument): AccessibleName | null {
  const id = attr(element, 'id');
  if (id !== null && id !== '') {
    for (const candidate of walk(document.root)) {
      if (candidate.tag === 'label' && attr(candidate, 'for') === id) {
        return contentName(candidate, document);
      }
    }
  }
  // A wrapping label.
  let current = element.parent;
  while (current !== null) {
    if (current.tag === 'label') return contentName(current, document);
    current = current.parent;
  }
  return null;
}

/**
 * Computes an accessible name.
 *
 * `elementsWithContentNaming` is the set of roles whose name may come from their own
 * content. Passing it explicitly rather than inferring from the tag lets a rule decide:
 * a link and a button name from content, an `img` and an `iframe` do not.
 */
export function accessibleName(
  element: MarloElement,
  document: MarloDocument,
  options: { readonly nameFromContent: boolean } = { nameFromContent: false },
): AccessibleName {
  // 1. aria-labelledby wins over everything.
  const labelledBy = attr(element, 'aria-labelledby');
  if (labelledBy !== null && normalise(labelledBy) !== '') {
    const ids = normalise(labelledBy).split(' ');
    const parts: string[] = [];
    let missing = false;

    for (const id of ids) {
      const target = byId(document, id);
      if (target === null) {
        missing = true;
        continue;
      }
      // A labelledby target contributes even when hidden, which is a real part of the
      // specification and a common source of confusion.
      parts.push(normalise(target.text));
    }

    const name = normalise(parts.join(' '));
    if (missing && name === '') {
      // Every reference dangles, so aria-labelledby contributes nothing and the
      // computation falls through. That is the specified behaviour and it is worth
      // reporting, because the author clearly intended a name.
      return {
        name: '',
        confidence: 'certain',
        from: 'aria-labelledby',
        reason: 'Every id in aria-labelledby refers to an element that does not exist.',
      };
    }
    return {
      name,
      confidence: missing ? 'uncertain' : 'certain',
      from: 'aria-labelledby',
      reason: missing ? 'Some ids in aria-labelledby do not resolve.' : null,
    };
  }

  // 2. aria-label.
  const ariaLabel = attr(element, 'aria-label');
  if (ariaLabel !== null && normalise(ariaLabel) !== '') {
    return { name: normalise(ariaLabel), confidence: 'certain', from: 'aria-label', reason: null };
  }

  // 3. The element's native mechanism.
  const native = nativeName(element, document);
  if (native !== null && (native.name !== '' || native.confidence === 'uncertain')) return native;

  // 4. Content, for roles that permit it.
  if (options.nameFromContent) {
    const content = contentName(element, document);
    if (content.name !== '' || content.confidence === 'uncertain') return content;
  }

  // 5. title.
  const title = attr(element, 'title');
  if (title !== null && normalise(title) !== '') {
    return { name: normalise(title), confidence: 'certain', from: 'title', reason: null };
  }

  // 6. For a text field, the placeholder, then aria-placeholder. HTML-AAM 4.1.1 names
  // these the last steps for input types text, password, number, search, tel, email and
  // url, and for textarea. Weak labelling, since it vanishes on input, but a name.
  if (takesPlaceholderName(element)) {
    for (const source of ['placeholder', 'aria-placeholder']) {
      const value = normalise(attr(element, source) ?? '');
      if (value !== '') {
        return { name: value, confidence: 'certain', from: 'placeholder', reason: null };
      }
    }
  }

  // A native mechanism that produced an empty string is a deliberate empty name, which
  // is different from no mechanism at all. `img alt=""` is the canonical case: it means
  // decorative, not unnamed.
  if (native !== null) return native;

  return NONE;
}

/** True when the element is exposed and its accessible name is empty. */
export function hasEmptyAccessibleName(
  element: MarloElement,
  document: MarloDocument,
  options?: { readonly nameFromContent: boolean },
): { readonly empty: boolean; readonly computed: AccessibleName } {
  const computed = accessibleName(element, document, options);
  return { empty: computed.name === '', computed };
}

export { isHiddenFromAssistiveTech };
