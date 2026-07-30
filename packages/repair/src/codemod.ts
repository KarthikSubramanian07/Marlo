import type { ActRuleId, Edit } from '@marlo/schema';
import { attributeOccurrences, indexElements, locate, matchesOf } from './locate.js';

/**
 * The mechanical fixes, and the reason the list is short.
 *
 * A rule qualifies for a codemod here only when the correct edit follows from the markup with
 * no judgment at all. That is a much narrower test than "the fix is obvious to me", and it rules
 * out most of the rules Marlo detects:
 *
 *   b5c3f8, a page with no `lang`. The fix needs to know what language the page is in, and
 *   guessing that from the text is a confident wrong answer waiting to happen.
 *
 *   23a2a8 and cae760, a missing accessible name. The fix needs the meaning, and if the page
 *   supplied it the name would already be there. `meaning-not-in-page` exists for this.
 *
 *   3ea0c8, a duplicated id. Renaming one breaks every reference to it, and choosing which one
 *   to keep is a decision about the rest of the codebase.
 *
 *   46ca7f, a decorative element that is focusable. Removing the role and removing the tabindex
 *   are both single-attribute edits and they mean opposite things.
 *
 *   afw4f7 and 09o5cg, contrast. Recolouring is somebody's design decision, which is
 *   [D-009](../../../DECISIONS.md) and not negotiable.
 *
 * What is left is seven rules where the edit is forced by the markup. Every one of them is a
 * deletion or a rename: nothing here invents content, and nothing here adds an attribute whose
 * value would have to be written by a human.
 *
 * THE GATE IS SEPARATE FROM THIS FILE, AND IT BITES
 *
 * Having a codemod does not make a rule auto-fixable. The engine reporting it also has to clear
 * 0.95 strict precision over at least 6 official test cases, and on the current table only two
 * of these seven do. The other five produce a `Flag` carrying the measurement that disqualified
 * them.
 *
 * That is the design working rather than a shortfall. A codemod admitted on the strength of
 * looking correct, for a rule whose detection is right 29% of the time, would apply four wrong
 * edits for every right one.
 */

export interface CodemodInput {
  readonly html: string;
  readonly file: string;
  readonly actRuleId: ActRuleId;
}

export interface CodemodResult {
  readonly edits: readonly Edit[];
  /**
   * Why there are no edits, when there are none. Null when edits were produced.
   *
   * A codemod that returns an empty array and no reason is indistinguishable from a codemod that
   * found nothing to do, and the two need different handling upstream.
   */
  readonly declined: string | null;
}

const NOTHING = (declined: string): CodemodResult => ({ edits: [], declined });
const DID = (edits: readonly Edit[]): CodemodResult => ({ edits, declined: null });

/**
 * Whether an attribute is written more than once on this element.
 *
 * NO CODEMOD MAY EDIT A DUPLICATED ATTRIBUTE, AND THIS IS WHY
 *
 * The parser shows exactly one occurrence of a duplicated attribute and drops the rest, so a
 * codemod editing "the" attribute is editing whichever one survived and is blind to the others.
 *
 * A property test found what that does. Given `<input aria-labeledby="" aria-labeledby="">`, the
 * ARIA name codemod renamed the occurrence the parser showed it, which unmasked the second copy,
 * and the result was `aria-labelledby="" aria-labeledby=""`. Applying it again renamed that one
 * too, producing a document with the same valid attribute twice. So one violation was turned
 * into a different one, idempotence was broken, and every step of it looked correct in
 * isolation.
 *
 * Declining is the right answer rather than renaming the first and deleting the rest, because
 * the second is two rules' worth of judgment in one edit. The duplication is its own rule
 * (e6952f) with its own codemod, and running that one first leaves this one with nothing to
 * trip over.
 */
function isDuplicated(
  html: string,
  el: { startTag: { start: number; end: number } },
  name: string,
): boolean {
  const occurrences = attributeOccurrences(html, el.startTag as never);
  return occurrences.filter((o) => o.name === name).length > 1;
}

/** Removes one attribute, and the whitespace in front of it so no double space is left. */
function removeAttribute(
  html: string,
  file: string,
  actRuleId: ActRuleId,
  range: { start: number; end: number },
  rationale: string,
): Edit {
  let start = range.start;
  while (start > 0 && /\s/.test(html[start - 1] ?? '')) start -= 1;
  return {
    file,
    start,
    end: range.end,
    before: html.slice(start, range.end),
    after: '',
    kind: 'remove-attribute',
    actRuleId,
    insertedElement: null,
    rationale,
  };
}

/* ── b4f0c3, a viewport that forbids zoom ─────────────────────────────────────── */

/**
 * `user-scalable=no` and a `maximum-scale` under 2 both stop a reader enlarging the page.
 *
 * Mechanical because the fix is a deletion from a comma-separated list whose grammar is fixed.
 * Nothing is invented: `width=device-width` and `initial-scale` are left exactly as they were.
 */
function viewport(input: CodemodInput): CodemodResult {
  const meta = locate(input.html, input.file, {
    tag: 'meta',
    attrs: { name: 'viewport' },
  });
  if (meta === null) return NOTHING('no single meta viewport element could be located in source');

  const range = meta.attrs.get('content');
  const value = meta.values.get('content');
  if (range === undefined || value === undefined) return NOTHING('the viewport has no content');

  const parts = value.split(',').map((p) => p.trim());
  const kept = parts.filter((part) => {
    const [key, raw] = part.split('=').map((s) => s.trim().toLowerCase());
    if (key === 'user-scalable') return raw !== 'no' && raw !== '0';
    if (key === 'maximum-scale') {
      const scale = Number(raw);
      return !Number.isFinite(scale) || scale >= 2;
    }
    return true;
  });
  if (kept.length === parts.length) return NOTHING('this viewport already permits zoom');

  const text = input.html.slice(range.start, range.end);
  const quote = text.includes('"') ? '"' : "'";
  return DID([
    {
      file: input.file,
      start: range.start,
      end: range.end,
      before: text,
      after: `content=${quote}${kept.join(', ')}${quote}`,
      kind: 'set-attribute-value',
      actRuleId: input.actRuleId,
      insertedElement: null,
      rationale:
        'Removes only the declarations that forbid zoom. Everything else in the viewport is ' +
        'left as it was.',
    },
  ]);
}

/* ── 5f99a7, an attribute that is not in WAI-ARIA ─────────────────────────────── */

/**
 * `aria-labeledby` is not an attribute. It is `aria-labelledby`, with two l characters, and the
 * misspelling fails silently in every browser.
 *
 * Mechanical, but only for a misspelling one edit away from a real attribute name. Anything
 * further than that is a guess about intent, and this declines rather than guessing.
 */
const ARIA_ATTRIBUTES = Object.freeze([
  'aria-activedescendant',
  'aria-atomic',
  'aria-autocomplete',
  'aria-busy',
  'aria-checked',
  'aria-colcount',
  'aria-colindex',
  'aria-colspan',
  'aria-controls',
  'aria-current',
  'aria-describedby',
  'aria-description',
  'aria-details',
  'aria-disabled',
  'aria-errormessage',
  'aria-expanded',
  'aria-flowto',
  'aria-haspopup',
  'aria-hidden',
  'aria-invalid',
  'aria-keyshortcuts',
  'aria-label',
  'aria-labelledby',
  'aria-level',
  'aria-live',
  'aria-modal',
  'aria-multiline',
  'aria-multiselectable',
  'aria-orientation',
  'aria-owns',
  'aria-placeholder',
  'aria-posinset',
  'aria-pressed',
  'aria-readonly',
  'aria-relevant',
  'aria-required',
  'aria-roledescription',
  'aria-rowcount',
  'aria-rowindex',
  'aria-rowspan',
  'aria-selected',
  'aria-setsize',
  'aria-sort',
  'aria-valuemax',
  'aria-valuemin',
  'aria-valuenow',
  'aria-valuetext',
]);

/** Edit distance, capped: anything over 1 is not a typo for this purpose. */
function isOneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return false;
  let i = 0;
  let j = 0;
  let differences = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    differences += 1;
    if (differences > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return true;
}

function ariaAttributeName(input: CodemodInput): CodemodResult {
  const edits: Edit[] = [];
  const undecidable: string[] = [];

  for (const el of indexElements(input.html, input.file)) {
    for (const [name, range] of el.attrs) {
      if (!name.startsWith('aria-')) continue;
      if (ARIA_ATTRIBUTES.includes(name)) continue;
      if (isDuplicated(input.html, el, name)) {
        undecidable.push(`${name} (written more than once, so fix e6952f first)`);
        continue;
      }
      const candidates = ARIA_ATTRIBUTES.filter((real) => isOneEditApart(name, real));
      if (candidates.length !== 1) {
        undecidable.push(name);
        continue;
      }
      const correct = candidates[0] ?? '';
      const text = input.html.slice(range.start, range.end);
      edits.push({
        file: input.file,
        start: range.start,
        end: range.start + name.length,
        before: text.slice(0, name.length),
        after: correct,
        kind: 'rename-attribute',
        actRuleId: input.actRuleId,
        insertedElement: null,
        rationale: `${name} is not an ARIA attribute and ${correct} is, one character away.`,
      });
    }
  }

  if (edits.length === 0) {
    return NOTHING(
      undecidable.length > 0
        ? `${undecidable.join(', ')} is not one character away from exactly one real ARIA ` +
            'attribute, so the intended name is a guess'
        : 'every aria- attribute here is defined in WAI-ARIA',
    );
  }
  return DID(edits);
}

/* ── 6a7281, an ARIA value that is not permitted ──────────────────────────────── */

/**
 * `aria-required="yes"` is not a value. The attribute takes `true` or `false`.
 *
 * Mechanical only for the four spellings that have exactly one correct reading. `aria-checked`
 * is excluded on purpose even though it looks similar: it also accepts `mixed`, so a value that
 * is neither true nor false is not necessarily an attempt at a boolean.
 */
const BOOLEAN_ARIA = Object.freeze([
  'aria-atomic',
  'aria-busy',
  'aria-disabled',
  'aria-modal',
  'aria-multiline',
  'aria-multiselectable',
  'aria-readonly',
  'aria-required',
]);
const BOOLEAN_SPELLINGS: Readonly<Record<string, string>> = Object.freeze({
  yes: 'true',
  no: 'false',
  '1': 'true',
  '0': 'false',
  TRUE: 'true',
  FALSE: 'false',
});

function ariaBooleanValue(input: CodemodInput): CodemodResult {
  const edits: Edit[] = [];
  for (const el of indexElements(input.html, input.file)) {
    for (const attribute of BOOLEAN_ARIA) {
      const value = el.values.get(attribute);
      const range = el.attrs.get(attribute);
      if (value === undefined || range === undefined) continue;
      if (value === 'true' || value === 'false') continue;
      // See isDuplicated: the parser shows one occurrence and hides the others.
      if (isDuplicated(input.html, el, attribute)) continue;
      const corrected = BOOLEAN_SPELLINGS[value] ?? BOOLEAN_SPELLINGS[value.toLowerCase()];
      if (corrected === undefined) continue;
      const text = input.html.slice(range.start, range.end);
      const quote = text.includes('"') ? '"' : "'";
      edits.push({
        file: input.file,
        start: range.start,
        end: range.end,
        before: text,
        after: `${attribute}=${quote}${corrected}${quote}`,
        kind: 'set-attribute-value',
        actRuleId: input.actRuleId,
        insertedElement: null,
        rationale: `${attribute} takes true or false. "${value}" reads as ${corrected}.`,
      });
    }
  }
  return edits.length > 0
    ? DID(edits)
    : NOTHING('no boolean ARIA attribute here has a value with exactly one correct reading');
}

/* ── e6952f, a duplicated attribute ───────────────────────────────────────────── */

/**
 * The rule no DOM can see, and the reason this package earns its place.
 *
 * Every HTML parser drops the second occurrence of an attribute before a tree exists, so
 * `<input name="a" name="b">` and `<input name="a">` are the same document to every engine.
 * `apps/demo/expected.json` records it as undetectable for that reason.
 *
 * With source location it is both detectable and mechanically fixable: the browser already
 * ignores the later occurrence, so deleting it changes nothing about how the page behaves and
 * removes the ambiguity for the next reader.
 */
function duplicateAttribute(input: CodemodInput): CodemodResult {
  const edits: Edit[] = [];
  for (const el of indexElements(input.html, input.file)) {
    const seen = new Set<string>();
    for (const occurrence of attributeOccurrences(input.html, el.startTag)) {
      if (!seen.has(occurrence.name)) {
        seen.add(occurrence.name);
        continue;
      }
      edits.push(
        removeAttribute(
          input.html,
          input.file,
          input.actRuleId,
          occurrence,
          `${occurrence.name} is given more than once on this element. Every parser already ` +
            'ignores this one, so removing it changes nothing except the ambiguity.',
        ),
      );
    }
  }
  return edits.length > 0 ? DID(edits) : NOTHING('no attribute is duplicated on any element');
}

/* ── 24afc2, 78fd32, 9e45ec: text spacing a reader cannot override ────────────── */

/**
 * A spacing declaration marked `!important` in a style attribute cannot be overridden by a user
 * stylesheet, which is the whole of WCAG 1.4.12.
 *
 * Mechanical because the fix is to delete the `!important`, not to change the value. The rule's
 * own message already says so. The declaration keeps whatever the author chose; it just stops
 * winning against the reader.
 */
const SPACING_PROPERTY: Readonly<Record<string, string>> = Object.freeze({
  '24afc2': 'letter-spacing',
  '78fd32': 'line-height',
  '9e45ec': 'word-spacing',
});

function importantSpacing(input: CodemodInput): CodemodResult {
  const property = SPACING_PROPERTY[input.actRuleId];
  if (property === undefined) return NOTHING(`${input.actRuleId} is not a text spacing rule`);

  const edits: Edit[] = [];
  for (const el of indexElements(input.html, input.file)) {
    const range = el.attrs.get('style');
    const value = el.values.get('style');
    if (range === undefined || value === undefined) continue;
    // See isDuplicated. Rewriting one of two style attributes leaves the other in place.
    if (isDuplicated(input.html, el, 'style')) continue;

    const pattern = new RegExp(`(${property}\\s*:[^;]*?)\\s*!\\s*important`, 'gi');
    if (!pattern.test(value)) continue;
    const cleaned = value.replace(new RegExp(pattern.source, 'gi'), '$1');

    const text = input.html.slice(range.start, range.end);
    const quote = text.includes('"') ? '"' : "'";
    edits.push({
      file: input.file,
      start: range.start,
      end: range.end,
      before: text,
      after: `style=${quote}${cleaned}${quote}`,
      kind: 'remove-style-declaration',
      actRuleId: input.actRuleId,
      insertedElement: null,
      rationale:
        `Removes !important from ${property} so a reader's own stylesheet can win. The value ` +
        'the author chose is untouched.',
    });
  }
  return edits.length > 0
    ? DID(edits)
    : NOTHING(`no style attribute here marks ${property} as important`);
}

/* ── The registry ─────────────────────────────────────────────────────────────── */

/**
 * Every rule with a mechanical fix, and nothing else.
 *
 * Adding an entry here is a claim that the correct edit follows from the markup with no
 * judgment. It does not make the rule auto-fixable: the routed engine still has to clear the
 * measured threshold, and `plan()` in verify.ts is where that is checked.
 */
export const CODEMODS: Readonly<Record<string, (input: CodemodInput) => CodemodResult>> =
  Object.freeze({
    b4f0c3: viewport,
    '5f99a7': ariaAttributeName,
    '6a7281': ariaBooleanValue,
    e6952f: duplicateAttribute,
    '24afc2': importantSpacing,
    '78fd32': importantSpacing,
    '9e45ec': importantSpacing,
  });

/** The rules a codemod exists for. Not the rules Marlo will fix without asking. */
export function rulesWithCodemods(): readonly string[] {
  return Object.keys(CODEMODS).sort();
}

export function runCodemod(input: CodemodInput): CodemodResult {
  const codemod = CODEMODS[input.actRuleId];
  if (codemod === undefined) {
    return NOTHING(
      `no codemod exists for ${input.actRuleId}. Either the correct fix needs a decision, or ` +
        'nobody has written one yet. See the comment at the top of codemod.ts.',
    );
  }
  return codemod(input);
}

/** Re-exported so verify.ts can explain an ambiguous location without importing locate. */
export { matchesOf };
