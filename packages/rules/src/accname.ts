import type { MarloDocument, MarloElement } from './dom.js';
import { attr, isHiddenFromAssistiveTech, normalise, walk } from './dom.js';

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
 * mechanism, then title as a last resort.
 */

export type NameConfidence = 'certain' | 'uncertain';

export interface AccessibleName {
  readonly name: string;
  readonly confidence: NameConfidence;
  /** Which step produced it. Reported so a fix knows what to change. */
  readonly from:
    'aria-labelledby' | 'aria-label' | 'native' | 'content' | 'title' | 'value' | 'none';
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

/**
 * Text content of an element for naming purposes.
 *
 * `uncertain` when a descendant carries `aria-label` or `aria-labelledby`, because the
 * real computation would recurse into those and this does not, or when CSS generated
 * content could contribute, which cannot be ruled out from the DOM.
 */
function contentName(element: MarloElement): AccessibleName {
  let uncertainReason: string | null = null;

  for (const node of walk(element)) {
    if (node === element) continue;
    if (attr(node, 'aria-label') !== null || attr(node, 'aria-labelledby') !== null) {
      uncertainReason =
        'A descendant carries aria-label or aria-labelledby, so the name depends on a ' +
        'recursive computation this implementation does not perform.';
      break;
    }
    // An image inside a link or button contributes its alt text to the name.
    if (node.tag === 'img' || node.tag === 'svg') {
      uncertainReason =
        'An image contributes to the name, and whether it does depends on how the ' +
        'renderer resolves it.';
      break;
    }
  }

  const text = normalise(element.text);
  if (text === '' && uncertainReason === null) return { ...NONE, from: 'content' };
  return {
    name: text,
    confidence: uncertainReason === null ? 'certain' : 'uncertain',
    from: 'content',
    reason: uncertainReason,
  };
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
      if (legend !== undefined) return contentName(legend);
      return null;
    }

    case 'table': {
      const caption = element.children.find((c) => c.tag === 'caption');
      if (caption !== undefined) return contentName(caption);
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

/** A form control's name from a `label`, either wrapping or by `for`. */
function labelName(element: MarloElement, document: MarloDocument): AccessibleName | null {
  const id = attr(element, 'id');
  if (id !== null && id !== '') {
    for (const candidate of walk(document.root)) {
      if (candidate.tag === 'label' && attr(candidate, 'for') === id) {
        return contentName(candidate);
      }
    }
  }
  // A wrapping label.
  let current = element.parent;
  while (current !== null) {
    if (current.tag === 'label') return contentName(current);
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
    const content = contentName(element);
    if (content.name !== '' || content.confidence === 'uncertain') return content;
  }

  // 5. title, last resort.
  const title = attr(element, 'title');
  if (title !== null && normalise(title) !== '') {
    return { name: normalise(title), confidence: 'certain', from: 'title', reason: null };
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
