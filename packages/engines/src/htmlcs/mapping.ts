import type { MappingEntry } from '../engine.js';
import { buildMapping } from '../engine.js';

/**
 * HTML CodeSniffer codes to ACT rule ids.
 *
 * Codes are normalised to `criterion.technique`, so
 * `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37` becomes `1_1_1.H37`. See
 * `normaliseCode` in the adapter.
 *
 * THE SMALLEST TABLE, AND THE ONE TO TRUST LEAST.
 *
 * Three reasons, all of which the calibration table will show rather than hide.
 *
 * HTML CodeSniffer reports by WCAG technique rather than by rule, and a technique is
 * not a rule: `H37` is "using alt attributes on img elements", which overlaps ACT
 * 23a2a8 without being it.
 *
 * It has no `passed` and no `inapplicable`. It emits only what it wants to say
 * something about, so the adapter infers a pass from silence. That inference is stated
 * in the adapter and is the weakest step in this package.
 *
 * Its `Warning` and `Notice` types both become `cantTell`, which is the honest
 * translation and costs strict recall heavily. An engine whose output is mostly
 * advisory will look weak in the strict view and consistent in the official one, which
 * is the exact gap D-004 exists to publish.
 *
 * Last upstream push January 2024. Carried as a risk in PLAN.md §6: it is a peer
 * rather than a dependency of the fix path, so dropping it would weaken the
 * one-directional invariant rather than break anything.
 */
const ENTRIES: readonly MappingEntry[] = [
  {
    engineRuleId: '1_1_1.H37',
    actId: '23a2a8',
    kind: 'superset',
    note: 'Technique H37 is alt attributes on img elements. Broader than the ACT rule, which is about the accessible name however it is computed.',
  },
  {
    engineRuleId: '1_1_1.H67.1',
    actId: 'e88epe',
    kind: 'partial',
    note: 'H67 covers images marked decorative. Related to the ACT rule about images not in the accessibility tree being decorative.',
  },
  {
    engineRuleId: '1_1_1.H24',
    actId: '8fc3b6',
    kind: 'partial',
    note: 'H24 is alt on area elements of an image map, adjacent to the object-name rule rather than identical to it.',
  },
  {
    engineRuleId: '3_1_1.H57.2',
    actId: 'b5c3f8',
    kind: 'exact',
    note: 'H57.2 is the lang attribute on the html element, which is exactly the ACT rule.',
  },
  {
    engineRuleId: '3_1_1.H57.3.Lang',
    actId: 'bf051a',
    kind: 'partial',
    note: 'H57.3 checks the lang value is well formed. Narrower than the ACT rule, which requires a valid language tag.',
  },
  {
    engineRuleId: '2_4_2.H25.1.NoTitleEl',
    actId: '2779a5',
    kind: 'exact',
    note: 'H25.1 is a missing or empty title element.',
  },
  {
    engineRuleId: '2_4_2.H25.1.EmptyTitle',
    actId: '2779a5',
    kind: 'exact',
    note: 'The empty-title half of the same check.',
  },
  {
    engineRuleId: '4_1_2.H91.A.Empty',
    actId: 'c487ae',
    kind: 'partial',
    note: 'H91 covers native element names. The .A.Empty variant is an anchor with no accessible name.',
  },
  {
    engineRuleId: '4_1_2.H91.A.NoContent',
    actId: 'c487ae',
    kind: 'partial',
    note: 'An anchor whose content contributes no name.',
  },
  {
    engineRuleId: '4_1_2.H91.Button.Name',
    actId: '97a4e1',
    kind: 'partial',
    note: 'A button with no accessible name.',
  },
  {
    engineRuleId: '4_1_2.H91.InputText.Name',
    actId: 'e086e5',
    kind: 'partial',
    note: 'A text input with no accessible name. Covers only one of the many field types the ACT rule applies to.',
  },
  {
    engineRuleId: '1_3_1.H43.HeadersRequired',
    actId: 'a25f45',
    kind: 'partial',
    note: 'H43 concerns headers attributes on table cells.',
  },
  {
    engineRuleId: '1_3_1.H63.1',
    actId: 'd0f69e',
    kind: 'partial',
    note: 'H63 is scope on header cells, adjacent to the ACT rule about header cells having assigned cells.',
  },
  {
    engineRuleId: '1_4_3.G18.Fail',
    actId: 'afw4f7',
    kind: 'partial',
    note: 'G18 is the minimum contrast technique. Needs layout, so expect cantTell on the static renderer.',
  },
  {
    engineRuleId: '1_4_6.G17.Fail',
    actId: '09o5cg',
    kind: 'partial',
    note: 'G17 is the enhanced contrast technique. Also needs layout.',
  },
  {
    engineRuleId: '2_2_1.F40.2',
    actId: 'bc659a',
    kind: 'partial',
    note: 'F40 is a meta refresh with a time-out. Failure technique rather than a rule, so the correspondence is approximate.',
  },
  {
    engineRuleId: '2_2_1.F41.2',
    actId: 'bisz58',
    kind: 'partial',
    note: 'F41 is a meta refresh used to reload the page, mapped to the no-exception variant.',
  },
];

export const HTMLCS_MAPPING = buildMapping(ENTRIES);
