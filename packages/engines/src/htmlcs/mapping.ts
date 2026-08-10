import type { MappingEntry } from '../engine.js';
import { buildMapping } from '../engine.js';

/**
 * HTML CodeSniffer codes to ACT rule ids.
 *
 * Codes are normalised to `criterion.technique`, so
 * `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37` becomes `1_1_1.H37`. See
 * `normaliseCode` in the adapter.
 *
 * THE SMALLEST TABLE, AND THE ONE TO TRUST LEAST. #43 asked whether that held up the
 * same way it asked about Alfa: run every mapped code over the corpus and see what it
 * actually catches, not what its name suggests. It held up, but not for free. Every
 * entry below is now `partial`, cited `f<n>/<n> p<n> i<n>` the way discover-mappings.mjs
 * and the axe table do, and not one earned `exact` or `superset`. That is the honest
 * result of measuring this engine, not an oversight: HTML CodeSniffer's checks are
 * WCAG techniques, narrower and more literal than the ACT rules they sit next to, and
 * every one of them missed something an ACT rule cares about or flagged something it
 * does not.
 *
 * FOUR ENTRIES ARE GONE RATHER THAN CARRIED FORWARD AS WEAK PARTIALS.
 *
 * Each fired on zero failing examples, and reading `html_codesniffer@2.5.1`'s source
 * (`node_modules/.pnpm/html_codesniffer@2.5.1/node_modules/html_codesniffer/build/HTMLCS.js`)
 * showed why, the same way it did for the two wrong Alfa rules: not bad luck, a
 * different condition than the one claimed.
 *
 *   H67.1  -> e88epe   H67.1 fires when alt="" is paired with a non-empty title
 *                      attribute, an accessible-name conflict. e88epe asks whether an
 *                      image excluded from the accessibility tree is actually
 *                      decorative in meaning. Neither is a narrowing of the other.
 *   H24    -> 8fc3b6   H24 fires on `<area>` elements of an image map missing alt
 *                      text. 8fc3b6's corpus is entirely `<object>` elements; H24
 *                      cannot fire on it no matter what the page contains. No ACT rule
 *                      in this corpus covers image-map area text, so this is a removal
 *                      with no replacement, not a swap.
 *   H91.A.Empty -> c487ae   Belongs to a WCAG2AAA-level sniff. The adapter always
 *                      requests the WCAG2AA standard, and HTML CodeSniffer's AA run
 *                      never reaches AAA-only sniffs, so this code cannot fire under
 *                      how this project calls the engine, full stop. `H91.A.NoContent`
 *                      is a genuine AA-level sibling and stays.
 *   H63.1  -> d0f69e   H63.1 fires on an ambiguity between `scope` and header-id usage
 *                      in a table already committed to `scope`. d0f69e asks whether a
 *                      `<th>` has any data cell assigned to it at all, a different
 *                      structural question H63.1 does not evaluate.
 *
 * ONE ENTRY POINTED AT THE WRONG SUBCODE IN ITS OWN TECHNIQUE FAMILY.
 *
 * `H43.HeadersRequired -> a25f45` fired on zero of a25f45's four failing examples.
 * a25f45 is about a `headers` attribute pointing at cells outside its own table; the
 * code for that in the same H43 family is `H43.IncorrectAttr`, which fires on two of
 * the four. The entry below cites the corrected code.
 *
 * TWO CONTRAST ENTRIES ARE KEPT DESPITE ZERO RECALL, BECAUSE THE ZERO ITSELF IS THE
 * FINDING.
 *
 * `G18.Fail -> afw4f7` and `G17.Fail -> 09o5cg` need a real layout and paint pipeline
 * to compute a contrast ratio, which the static renderer does not provide, so neither
 * ever fires. That alone matches Alfa's and axe's contrast rules on the same renderer.
 * What does not match: Alfa and axe report `cantTell` when they cannot compute
 * contrast, an honest admission of not knowing. HTML CodeSniffer stays completely
 * silent instead (confirmed by running it directly: no Error, no Warning, no Notice on
 * any contrast example), and this adapter reads silence on a claimed rule as `passed`.
 * So on every one of afw4f7 and 09o5cg's failing corpus examples, this engine's
 * column reports a pass it has no basis for. Removing the entries would hide that;
 * keeping them with the true zero on record is what #43 was for.
 *
 * Last upstream push January 2024. Carried as a risk in PLAN.md §6: it is a peer
 * rather than a dependency of the fix path, so dropping it would weaken the
 * one-directional invariant rather than break anything.
 */
const ENTRIES: readonly MappingEntry[] = [
  {
    engineRuleId: '1_1_1.H37',
    actId: '23a2a8',
    kind: 'partial',
    note: 'f3/5 p2 i2. H37 fires only when an img element\'s alt attribute is entirely absent. Misses failing examples where the name is missing by other means: a whitespace-only alt, and role="img" on a non-img element H37 never inspects. False positives where alt is absent but the accessible name comes from elsewhere anyway (a title attribute, or role="none" removing the element from the tree), and one inapplicable example where the image is hidden via CSS, which H37 does not check for.',
  },
  {
    engineRuleId: '3_1_1.H57.2',
    actId: 'b5c3f8',
    kind: 'partial',
    note: 'f1/4 p0 i2. H57.2 fires when the html element has neither a lang nor an xml:lang attribute, which is the ACT rule exactly, but most of this corpus\'s failing examples use lang="" (present, empty) rather than an absent attribute. A present-but-empty lang fails HTMLCS\'s language-tag validity check instead and is reported as H57.3.Lang, so H57.2 alone catches only the fully-absent case.',
  },
  {
    engineRuleId: '3_1_1.H57.3.Lang',
    actId: 'bf051a',
    kind: 'partial',
    note: "f1/4 p1 i0. H57.3.Lang fires when a present lang or xml:lang value fails a BCP-47-shaped regex, which is narrower than the ACT rule's notion of a valid primary language subtag, and both misses and over-flags on this small sample of seven cases.",
  },
  {
    engineRuleId: '2_4_2.H25.1.NoTitleEl',
    actId: '2779a5',
    kind: 'partial',
    note: 'f4/5 p3 i1. H25.1.NoTitleEl fires on a missing or whitespace-only title element, catching four of five failing examples on its own. The false positives are documents whose title is inferable by other means the ACT rule accepts but this narrow check does not (an SVG title element, for one).',
  },
  {
    engineRuleId: '2_4_2.H25.1.EmptyTitle',
    actId: '2779a5',
    kind: 'partial',
    note: "f1/5 p0 i0. The empty-string-title half of the same check, `<title></title>` with zero characters rather than whitespace. Catches the one failing example NoTitleEl's own condition does not reach, cleanly, but on its own is far short of full recall.",
  },
  {
    engineRuleId: '4_1_2.H91.A.NoContent',
    actId: 'c487ae',
    kind: 'partial',
    note: 'f2/11 p0 i0. Fires on an anchor with a valid href but no link content at all. Clean where it fires, but it is one narrow shape among the many ways a link can end up without an accessible name, so recall against the full ACT rule is low.',
  },
  {
    engineRuleId: '4_1_2.H91.Button.Name',
    actId: '97a4e1',
    kind: 'partial',
    note: "f4/5 p0 i2. Fires on a native button element with no accessible name. Misses one failing example that is not a native button, and flags two non-failing examples whose name HTML CodeSniffer's narrower computation does not find but the ACT rule's does.",
  },
  {
    engineRuleId: '4_1_2.H91.Span.Name',
    actId: '97a4e1',
    kind: 'partial',
    note: 'f1/5 p0 i0. The same accessible-name check as H91.Button.Name, for a span carrying role="button" instead of a native button element. Catches the one failing example in this corpus that is shaped that way, cleanly, and is added here as a genuine sibling rather than folded into the note above.',
  },
  {
    engineRuleId: '4_1_2.H91.InputText.Name',
    actId: 'e086e5',
    kind: 'partial',
    note: 'f3/7 p1 i0. Fires on a text input with no accessible name, one of the several field types e086e5 covers. Narrow by construction: it only inspects text inputs, so recall against the full rule is well under half.',
  },
  {
    engineRuleId: '1_3_1.H43.IncorrectAttr',
    actId: 'a25f45',
    kind: 'partial',
    note: "f2/4 p0 i0. Corrected from H43.HeadersRequired, which fired on zero of this rule's failing examples because it checks a table missing headers entirely, not a headers attribute pointing outside its own table. H43.IncorrectAttr is the code in the same technique family that actually checks a25f45's condition, and reading the source confirmed it: `t.wrongHeaders`, a headers id that resolves to a cell outside the current table.",
  },
  {
    engineRuleId: '1_4_3.G18.Fail',
    actId: 'afw4f7',
    kind: 'partial',
    note: "f0/8 p0 i0 ct0. Needs a real layout and paint pipeline to compute a contrast ratio, which the static renderer does not provide, so it never fires, not even the related G18.BgImage/G18.Alpha advisory codes that this same run does emit elsewhere on the corpus. Unlike Alfa and axe on the same limitation, which report cantTell, this engine's silence on a claimed rule is read as passed, so every failing contrast example in this corpus is reported as a pass with no basis for it. See HONESTY.md.",
  },
  {
    engineRuleId: '1_4_6.G17.Fail',
    actId: '09o5cg',
    kind: 'partial',
    note: 'f0/10 p0 i0 ct0. The enhanced-contrast counterpart to G18.Fail above, same cause, same silent-passed outcome on every failing example. See HONESTY.md.',
  },
  {
    engineRuleId: '2_2_1.F40.2',
    actId: 'bc659a',
    kind: 'partial',
    note: 'f1/4 p0 i0. F40 is the failure technique for a meta refresh with a time-out and no way to turn it off, a narrower shape than the ACT rule it sits next to, so it catches only one of four failing examples, cleanly.',
  },
  {
    engineRuleId: '2_2_1.F41.2',
    actId: 'bisz58',
    kind: 'partial',
    note: 'f3/4 p2 i0. F41 is the failure technique for a meta refresh used to reload the page. Decent recall on this corpus, but two false positives where a refresh HTML CodeSniffer treats as the F41 shape is one the ACT rule does not flag.',
  },
];

export const HTMLCS_MAPPING = buildMapping(ENTRIES);
