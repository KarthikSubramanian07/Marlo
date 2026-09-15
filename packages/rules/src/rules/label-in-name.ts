import { defineRule } from '../define.js';
import { accessibleName } from '../accname.js';
import type { MarloElement } from '../dom.js';
import { ancestors, attr, hasAttr, isVisuallyHidden, normalise, walk } from '../dom.js';
import { explicitRole } from './aria.js';

/**
 * 2ee8b8: the visible label of a control is part of its accessible name, so a speech
 * input user can say what they see.
 *
 * The comparison is ACT's label in name algorithm, and that part is exact: drop what is
 * in round brackets, fold case, decompose, keep letters and digits, split into words,
 * and ask whether the label's words appear in the name as one unbroken run.
 *
 * The input to it is not exact, because the label is the "visible inner text", which
 * depends on CSS. A block element puts a line break between two words that sit side by
 * side in the DOM, a class can hide a word, and an icon font draws the word "search" as
 * a magnifying glass. This rule declares only `dom`, so it reads visibility from the
 * `hidden` attribute and inline styles, and for everything else it computes the answer
 * under each reading CSS could produce and commits only when they agree:
 *
 *   with and without a word break at every element boundary;
 *   with each descendant element removed, in case a stylesheet hides it;
 *   a single letter, which is often a symbol such as "X" for close;
 *   a single lower-case word on a styled page, which is how a ligature icon is written.
 *
 * Two of the rule's applicability conditions are about language rather than markup: no
 * abbreviations, and the same spelling and hyphenation in both strings. Marlo does not
 * judge either. When a word of the label is a prefix of a word of the name, or the label
 * matches once word breaks are ignored, the answer is `cantTell`, because either could
 * put the element outside the rule.
 *
 * What is left to fail is a label whose words are plainly not in the name under every
 * reading, which is the defect the criterion is about: `aria-label` overwriting the
 * visible text with something else.
 */

/** Widget roles that take their name from content, as ACT lists them for this rule. */
const NAME_FROM_CONTENT_WIDGETS: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'gridcell',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'switch',
  'tab',
  'treeitem',
]);

function widgetRole(element: MarloElement): string | null {
  const explicit = explicitRole(element);
  if (explicit !== null) return NAME_FROM_CONTENT_WIDGETS.has(explicit) ? explicit : null;
  switch (element.tag) {
    case 'a':
      return hasAttr(element, 'href') ? 'link' : null;
    case 'button':
      return 'button';
    case 'option':
      return 'option';
    default:
      return null;
  }
}

/** Content that never renders, even though `textContent` includes it. */
const UNRENDERED: ReadonlySet<string> = new Set(['script', 'style', 'template', 'noscript']);

/** Hidden by its own attributes, as opposed to by an ancestor. */
function hidesItself(element: MarloElement): boolean {
  if (hasAttr(element, 'hidden')) return true;
  const style = attr(element, 'style') ?? '';
  return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!\s*important)?\s*(?:;|$)/i.test(
    style,
  );
}

/**
 * The visible text of an element in document order, or null when the child texts cannot
 * be located inside the parent's, which would mean the order is not known.
 *
 * `breaks` puts a space at every element boundary, the reading where every element is a
 * block. `omit` is removed as if a stylesheet hid it.
 */
function visibleText(
  element: MarloElement,
  breaks: boolean,
  omit: MarloElement | null,
): string | null {
  if (element === omit || UNRENDERED.has(element.tag) || hidesItself(element)) {
    return breaks ? ' ' : '';
  }
  if (element.tag === 'br') return ' ';
  let out = '';
  let cursor = 0;
  for (const child of element.children) {
    const at = element.text.indexOf(child.text, cursor);
    if (at === -1) return null;
    const inner = visibleText(child, breaks, omit);
    if (inner === null) return null;
    out += element.text.slice(cursor, at) + (breaks ? ` ${inner} ` : inner);
    cursor = at + child.text.length;
  }
  return out + element.text.slice(cursor);
}

/** ACT's tokenizer: brackets removed, folded, decomposed, letters and digits only. */
function labelTokens(text: string): readonly string[] {
  let value = text;
  for (let previous = ''; previous !== value;) {
    previous = value;
    value = value.replace(/\([^()]*\)/g, ' ');
  }
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      // Combining marks are dropped rather than turned into spaces, so a decomposed
      // accent does not split the word it belongs to. Both strings get the same
      // treatment, so containment is unaffected.
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((token) => token !== '')
  );
}

/** Whether `part` appears in `whole` as one contiguous run. The empty list always does. */
function isContiguousSubsequence(part: readonly string[], whole: readonly string[]): boolean {
  if (part.length === 0) return true;
  for (let start = 0; start + part.length <= whole.length; start += 1) {
    if (part.every((token, offset) => whole[start + offset] === token)) return true;
  }
  return false;
}

function quote(tokens: readonly string[]): string {
  return `"${tokens.join(' ')}"`;
}

/**
 * Whether some run of whole name words, written together, spells `joined` exactly:
 * "nonstandard" against "non standard". Word edges must line up, so "1" is not found
 * in "1a".
 */
function joinsToRun(joined: string, name: readonly string[]): boolean {
  if (joined === '') return false;
  for (let start = 0; start < name.length; start += 1) {
    let run = '';
    for (const word of name.slice(start)) {
      run += word;
      if (run === joined) return true;
      if (run.length >= joined.length) break;
    }
  }
  return false;
}

/** Why the words might differ for a reason the rule excludes, or null. */
function languageDoubt(label: readonly string[], name: readonly string[]): string | null {
  if (joinsToRun(label.join(''), name)) {
    return 'the words match once spacing and hyphenation are ignored, and a difference in hyphenation puts the element outside this rule';
  }
  for (const word of label) {
    if (name.includes(word) || !/^\p{L}{2,}$/u.test(word)) continue;
    const partner = name.find(
      (other) => /^\p{L}{2,}$/u.test(other) && (other.startsWith(word) || word.startsWith(other)),
    );
    if (partner !== undefined) {
      return `"${word}" and "${partner}" may be an abbreviation and its expansion, which this rule does not cover`;
    }
  }
  return null;
}

/** 2ee8b8: the visible label is part of the accessible name. */
export const labelInName = defineRule({
  actId: '2ee8b8',
  name: 'Visible label is part of accessible name',
  successCriteria: ['2.5.3'],
  requires: ['dom'],
  // Which of the two strings is right is a content decision, and so is the wording.
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      if (widgetRole(element) === null) continue;
      if (!hasAttr(element, 'aria-label') && !hasAttr(element, 'aria-labelledby')) continue;
      if (isVisuallyHidden(element)) continue;
      if (normalise(visibleText(element, false, null) ?? element.text) === '') continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    const computed = accessibleName(element, document, { nameFromContent: true });
    if (computed.confidence === 'uncertain') {
      return {
        outcome: 'cantTell',
        message: `Marlo could not compute this element's accessible name reliably. ${computed.reason ?? ''}`,
      };
    }
    if (computed.from !== 'aria-label' && computed.from !== 'aria-labelledby') {
      // An empty aria-label, or none, leaves the name to the content itself.
      return {
        outcome: 'passed',
        message: 'The accessible name comes from the visible text, so the label is in it.',
      };
    }
    if (computed.name === '') {
      return {
        outcome: 'cantTell',
        message:
          `${computed.reason ?? 'aria-labelledby names nothing.'} The name then falls through to ` +
          'aria-label or the content, and Marlo does not compute that fall-through.',
      };
    }

    const plain = visibleText(element, false, null);
    const broken = visibleText(element, true, null);
    if (plain === null || broken === null) {
      return {
        outcome: 'cantTell',
        message: 'Marlo could not put the text inside this element in order.',
      };
    }
    const name = labelTokens(computed.name);
    const tight = labelTokens(plain);
    const spaced = labelTokens(broken);
    const tightFits = isContiguousSubsequence(tight, name);
    const spacedFits = isContiguousSubsequence(spaced, name);

    if (tightFits && spacedFits) {
      return {
        outcome: 'passed',
        message: `The visible label ${quote(tight)} is part of the accessible name "${computed.name}".`,
      };
    }
    if (tightFits !== spacedFits) {
      return {
        outcome: 'cantTell',
        message:
          `Whether the label reads ${quote(tight)} or ${quote(spaced)} depends on whether CSS ` +
          `renders the elements inside as blocks, and only one of them is in the name "${computed.name}".`,
      };
    }

    const doubt = labelDoubt(element, tight, name, document.root);
    if (doubt !== null) {
      return {
        outcome: 'cantTell',
        message: `The visible label ${quote(tight)} is not in the accessible name "${computed.name}", but ${doubt}.`,
      };
    }

    return {
      outcome: 'failed',
      message:
        `This ${widgetRole(element) ?? 'control'} shows ${quote(tight)} and is named "${computed.name}" (from ` +
        `${computed.from}). A speech input user who says what they see gets no match. Start the ` +
        'accessible name with the visible words, or remove the override.',
    };
  },
});

/** Why a failing comparison may still be a pass once CSS is applied, or null. */
function labelDoubt(
  element: MarloElement,
  label: readonly string[],
  name: readonly string[],
  root: MarloElement,
): string | null {
  const first = label[0];
  if (label.length === 1 && first !== undefined && /^\p{L}$/u.test(first)) {
    return `a single "${first}" is often a symbol, such as X for close, which the rule ignores`;
  }

  const text = normalise(element.text);
  if (/^[a-z][a-z0-9_]*$/.test(text)) {
    const styled = [...walk(root)].some(
      (e) =>
        e.tag === 'style' ||
        (e.tag === 'link' && /(?:^|\s)stylesheet(?:\s|$)/i.test(attr(e, 'rel') ?? '')),
    );
    const classed = [...ancestors(element), ...walk(element)].some((e) => hasAttr(e, 'class'));
    if (styled || classed) {
      return `"${text}" is written the way an icon font ligature is, and drawn as an icon it is not text`;
    }
  }

  if ([...walk(element)].some((e) => e.tag === 'abbr')) {
    return 'it contains an abbr element, and abbreviations are outside this rule';
  }

  const language = languageDoubt(label, name);
  if (language !== null) return language;

  const total = element.text.replace(/\s+/g, '').length;
  for (const descendant of walk(element)) {
    if (descendant === element) continue;
    const size = descendant.text.replace(/\s+/g, '').length;
    // Hiding every character would leave no visible label at all, which is not the
    // visually hidden pattern this looks for.
    if (size === 0 || size === total) continue;
    const without = visibleText(element, false, descendant);
    if (without !== null && isContiguousSubsequence(labelTokens(without), name)) {
      return `it would be if the <${descendant.tag}> holding "${normalise(descendant.text)}" were visually hidden by a stylesheet, which this check cannot see`;
    }
  }
  return null;
}
