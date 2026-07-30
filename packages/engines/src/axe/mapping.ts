import type { MappingEntry } from '../engine.js';
import { buildMapping } from '../engine.js';

/**
 * axe-core rule ids to ACT rule ids.
 *
 * DERIVED FROM EVIDENCE, NOT FROM MEMORY.
 *
 * Every entry below was proposed by running axe-core over all 1134 official ACT test
 * cases and recording which axe rules fired on which examples, then reviewed by hand.
 * Reproduce with `pnpm mappings:discover --engine axe`. The counts in each note are
 * from the corpus at `corpus/act/MANIFEST.json`, retrieved 2026-07-29, and read as:
 *
 *   f  fired on a failing example. Wanted.
 *   p  fired on a passing example. A false positive against this rule.
 *   i  fired on an inapplicable example. Also a false positive.
 *   ct returned `incomplete`, which is `cantTell`. Costs strict recall.
 *
 * THE METHODOLOGY FINDING WORTH KNOWING BEFORE YOU ADD AN ENTRY.
 *
 * ACT test case documents are minimal fragments. Most have no title, no `lang`, no
 * `main` landmark and no `h1`. So axe's page-level rules fire on almost everything:
 * `landmark-one-main` on 1110 of 1134 cases, `page-has-heading-one` on 1075,
 * `document-title` on 1006, `region` on 774, `html-has-lang` on 809.
 *
 * A naive correlation would therefore "discover" that `landmark-one-main` implements
 * 90 of 91 ACT rules. The discovery script filters rules firing on more than a quarter
 * of the corpus and reports them separately, and the two cases where a page-level rule
 * genuinely is the right mapping (`document-title` for 2779a5, `html-has-lang` for
 * b5c3f8) were checked individually against their own rule's examples.
 *
 * THE SECOND FINDING, WHICH VALIDATES THE CAPABILITY MODEL.
 *
 * axe's `color-contrast` returned `incomplete` on all 19 of afw4f7's test cases and
 * never `failed`, because happy-dom does not perform layout so axe cannot resolve the
 * colours. It correctly declined rather than guessing. That is the same conclusion the
 * capability model reaches by declaration, arrived at independently by axe at runtime,
 * and it is why the contrast entries are marked `partial` with a note pointing at the
 * browser renderer rather than being left to look like coverage.
 */
const ENTRIES: readonly MappingEntry[] = [
  // Language. The cleanest correspondences in the whole table.
  {
    engineRuleId: 'html-has-lang',
    actId: 'b5c3f8',
    kind: 'superset',
    note: "f4/4 p0 i2. Catches every failing example. Also fires on 2 of the rule's inapplicable examples, which are non-HTML documents the ACT rule excludes, so precision against this rule understates axe.",
  },
  {
    engineRuleId: 'html-lang-valid',
    actId: 'bf051a',
    kind: 'exact',
    note: 'f4/4 p0 i0. Clean on every example.',
  },
  {
    engineRuleId: 'valid-lang',
    actId: 'de46e4',
    kind: 'exact',
    note: 'f9/9 p0 i0. The largest clean correspondence found.',
  },
  {
    engineRuleId: 'html-xml-lang-mismatch',
    actId: '5b7ae0',
    kind: 'exact',
    note: 'f2/2 p0 i0. axe compares lang against xml:lang, which is the whole of the ACT rule.',
  },

  // Page title.
  {
    engineRuleId: 'document-title',
    actId: '2779a5',
    kind: 'superset',
    note: "f5/5 p0 i1. A page-level rule that fires on 1006 of 1134 corpus documents, but on this rule's own examples it is precise. Checked individually because the global rate would otherwise have hidden it.",
  },

  // Accessible names. Several axe rules per ACT rule is normal here: axe splits by
  // element type to give better remediation advice, which the ACT mapping guidance
  // explicitly anticipates.
  {
    engineRuleId: 'link-name',
    actId: 'c487ae',
    kind: 'partial',
    note: 'f10/11 p0 i0. Misses one failing example. Combined with image-alt and area-alt below, the set covers all 11.',
  },
  {
    engineRuleId: 'image-alt',
    actId: 'c487ae',
    kind: 'partial',
    note: "f4/11 p0 i0. Fires where the link's only content is an image with no name. Part of the implementation set for this rule.",
  },
  {
    engineRuleId: 'area-alt',
    actId: 'c487ae',
    kind: 'partial',
    note: 'f1/11 p0 i0. Image map areas.',
  },
  {
    engineRuleId: 'image-alt',
    actId: '23a2a8',
    kind: 'partial',
    note: 'f4/5 p0 i0. Misses the role="img" case, which role-img-alt covers.',
  },
  {
    engineRuleId: 'role-img-alt',
    actId: '23a2a8',
    kind: 'partial',
    note: 'f1/5 p0 i0. The role="img" half of the rule.',
  },
  {
    engineRuleId: 'button-name',
    actId: '97a4e1',
    kind: 'partial',
    note: 'f4/5 p0 i0. aria-command-name covers the remaining example.',
  },
  {
    engineRuleId: 'aria-command-name',
    actId: '97a4e1',
    kind: 'partial',
    note: 'f1/5 p0 i0. role="button" on a non-button element.',
  },
  {
    engineRuleId: 'aria-input-field-name',
    actId: 'e086e5',
    kind: 'partial',
    note: 'f3/7 p0 i0. ARIA-role form fields.',
  },
  {
    engineRuleId: 'label',
    actId: 'e086e5',
    kind: 'partial',
    note: 'f3/7 p0 i0. Native inputs.',
  },
  {
    engineRuleId: 'select-name',
    actId: 'e086e5',
    kind: 'partial',
    note: 'f1/7 p0 i0. Select elements. The three together reach 7 of 7.',
  },
  {
    engineRuleId: 'empty-heading',
    actId: 'ffd0e9',
    kind: 'exact',
    note: 'f8/8 p0 i0. axe checks a heading computes a non-empty accessible name, by any means, which is the ACT rule exactly.',
  },
  {
    engineRuleId: 'frame-title',
    actId: 'cae760',
    kind: 'exact',
    note: "f4/4 p0 i0. axe accepts title, aria-label and aria-labelledby, matching the ACT rule's accessible name computation.",
  },
  {
    engineRuleId: 'object-alt',
    actId: '8fc3b6',
    kind: 'exact',
    note: 'f4/4 p0 i0. Applies to object elements rendering non-text content, the same applicability the ACT rule declares.',
  },
  {
    engineRuleId: 'svg-img-alt',
    actId: '7d6734',
    kind: 'exact',
    note: "f4/4 p0 i0. Restricted to svg with an explicit img, graphics-document or graphics-symbol role, which is the ACT rule's applicability.",
  },
  {
    engineRuleId: 'input-image-alt',
    actId: '59796f',
    kind: 'exact',
    note: 'f3/3 p0 i0. input type=image specifically, which is what the ACT rule scopes to.',
  },
  {
    engineRuleId: 'button-name',
    actId: 'm6b1q3',
    kind: 'partial',
    note: 'f2/2 i1. Menuitem names. Fires on one inapplicable example, so precision against this rule understates axe.',
  },

  // ARIA validity. The category where axe is strongest.
  {
    engineRuleId: 'aria-valid-attr',
    actId: '5f99a7',
    kind: 'exact',
    note: 'f2/2 p0 i0. axe checks the attribute name exists in ARIA, not its value, which is the split the two ACT rules make.',
  },
  {
    engineRuleId: 'aria-valid-attr-value',
    actId: '6a7281',
    kind: 'partial',
    note: 'f9/10 p0 i0 ct1. One example returned incomplete rather than failed, which costs strict recall and is visible in the cantTell column.',
  },
  {
    engineRuleId: 'aria-allowed-attr',
    actId: '5c01ea',
    kind: 'partial',
    note: 'f1/2 p0 i0. Catches half the failing examples. The other concerns a global property on a role that prohibits it.',
  },
  {
    engineRuleId: 'aria-roles',
    actId: '674b10',
    kind: 'exact',
    note: 'f2/2 p0 i0. Checks the role token is a defined non-abstract role, matching the ACT rule.',
  },
  {
    engineRuleId: 'aria-required-attr',
    actId: '4e8ab6',
    kind: 'exact',
    note: "f2/2 p0 i0. Checks required states and properties for the element's role are present.",
  },
  {
    engineRuleId: 'aria-required-children',
    actId: 'bc4a75',
    kind: 'superset',
    note: 'f7/7 p1. Complete recall, and fires on one passing example, so it is checking something slightly broader than the ACT rule.',
  },
  {
    engineRuleId: 'aria-required-parent',
    actId: 'ff89c9',
    kind: 'partial',
    note: 'f2/4 p0 i0. Half the failing examples.',
  },
  {
    engineRuleId: 'aria-hidden-focus',
    actId: '6cfa84',
    kind: 'partial',
    note: 'f5/6 p0 i0 ct2. One miss and two incompletes. The incompletes need focus order, which the static renderer cannot establish.',
  },
  {
    engineRuleId: 'nested-interactive',
    actId: '307n5z',
    kind: 'exact',
    note: 'f3/3 p0 i0. Presentational children with focusable content.',
  },
  {
    engineRuleId: 'presentation-role-conflict',
    actId: '46ca7f',
    kind: 'exact',
    note: 'f3/3 p0 i0. Fires where role=presentation or none is overridden by a global ARIA attribute or focusability, which is how an element marked decorative gets exposed anyway.',
  },

  // Structure and metadata.
  {
    engineRuleId: 'meta-refresh',
    actId: 'bc659a',
    kind: 'superset',
    note: "f4/4 p1. Complete recall. Fires on one passing example, because axe does not implement the ACT rule's exception for a long delay.",
  },
  {
    engineRuleId: 'meta-refresh',
    actId: 'bisz58',
    kind: 'partial',
    note: 'f3/4 p1. The no-exception variant of the same rule. One axe rule serving two ACT rules is expected: the two ACT rules differ only in an exception.',
  },
  {
    engineRuleId: 'meta-viewport',
    actId: 'b4f0c3',
    kind: 'exact',
    note: 'f4/4 p0 i0. Checks user-scalable and maximum-scale do not prevent zoom, which is the ACT rule.',
  },
  {
    engineRuleId: 'td-headers-attr',
    actId: 'a25f45',
    kind: 'exact',
    note: 'f4/4 p0 i0. Checks every id in a headers attribute resolves to a cell in the same table.',
  },
  {
    engineRuleId: 'th-has-data-cells',
    actId: 'd0f69e',
    kind: 'partial',
    note: 'f0/3 ct3. Returned incomplete on all three failing examples rather than failed, because it needs layout to decide which cells a header covers. Mapped so the cantTell is visible in the table rather than looking like an absent implementation. Try the browser renderer.',
  },
  {
    engineRuleId: 'autocomplete-valid',
    actId: '73f2c2',
    kind: 'exact',
    note: 'f5/5 p0 i0. Validates the autocomplete token list against the HTML specification, which is what the ACT rule requires.',
  },
  {
    engineRuleId: 'duplicate-id-aria',
    actId: '3ea0c8',
    kind: 'partial',
    note: 'f0/3 ct3. axe removed the general duplicate-id rule in 4.x and kept only the ARIA-reference variant, which returns incomplete here. So axe now covers strictly less of this rule than it used to, which is worth knowing before relying on it.',
  },

  // Text spacing. One axe rule spans three ACT rules, which differ only in the
  // property they inspect.
  {
    engineRuleId: 'avoid-inline-spacing',
    actId: '24afc2',
    kind: 'partial',
    note: 'f2/4 i1 ct1. Letter spacing.',
  },
  {
    engineRuleId: 'avoid-inline-spacing',
    actId: '9e45ec',
    kind: 'partial',
    note: 'f2/4 i1 ct1. Word spacing.',
  },
  {
    engineRuleId: 'avoid-inline-spacing',
    actId: '78fd32',
    kind: 'partial',
    note: 'f0/6 on the static renderer: line height needs a resolved computed style, so axe declined entirely. Mapped so the gap is reported rather than silent.',
  },

  // Contrast. Kept, with the honest note, because omitting them would make the table
  // silent about the rules users ask about most.
  {
    engineRuleId: 'color-contrast',
    actId: 'afw4f7',
    kind: 'partial',
    note: 'f0/8 ct19 on the static renderer. axe returned incomplete on every example rather than guessing, because happy-dom does not lay out and the colours cannot be resolved. Independent confirmation of the capability model in DECISIONS.md D-005. Run --renderer browser for a real measurement.',
  },
  {
    engineRuleId: 'color-contrast-enhanced',
    actId: '09o5cg',
    kind: 'partial',
    note: 'f0/10 on the static renderer, for the same reason as afw4f7.',
  },

  // Landmarks. Weak, and labelled weak.
  {
    engineRuleId: 'landmark-one-main',
    actId: 'b40fd1',
    kind: 'partial',
    note: 'f3/3 p1 i1. Complete recall on this rule but a page-level rule firing on 1110 of 1134 corpus documents, so the precision figure here is close to meaningless and the entry exists mainly so the one-directional invariant can see it.',
  },
];

export const AXE_MAPPING = buildMapping(ENTRIES);
