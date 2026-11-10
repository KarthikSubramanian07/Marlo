import { allCoveredCriteria, compareCriteria } from './rules.js';

/**
 * The WCAG success criteria no scan can examine, because no published ACT rule maps to
 * them.
 *
 * Marlo reports ACT rules only, since every number it publishes needs official test
 * cases behind it. A criterion with no ACT rule therefore never appears in a report, and
 * a clean report says nothing about it. Leaving that unsaid lets a clean report be read
 * as a pass of 2.5.8 Target Size, which a WCAG 2.2 AA pass over 54 repositories found
 * failing in 21 of them (issue #162). DECISIONS.md D-017 records why the answer is to
 * say so rather than to report a peer engine's unmeasured check.
 */

/**
 * Every level A and AA success criterion in WCAG 2.2, the W3C Recommendation of
 * 5 October 2023 as updated 12 December 2024. 4.1.1 Parsing is absent because WCAG 2.2
 * removed it. Typed rather than derived, because the corpus only records the criteria
 * its rules map to, which is the other half of the subtraction below.
 */
export const WCAG22_A_AA_CRITERIA: readonly string[] = Object.freeze([
  '1.1.1',
  '1.2.1',
  '1.2.2',
  '1.2.3',
  '1.2.4',
  '1.2.5',
  '1.3.1',
  '1.3.2',
  '1.3.3',
  '1.3.4',
  '1.3.5',
  '1.4.1',
  '1.4.2',
  '1.4.3',
  '1.4.4',
  '1.4.5',
  '1.4.10',
  '1.4.11',
  '1.4.12',
  '1.4.13',
  '2.1.1',
  '2.1.2',
  '2.1.4',
  '2.2.1',
  '2.2.2',
  '2.3.1',
  '2.4.1',
  '2.4.2',
  '2.4.3',
  '2.4.4',
  '2.4.5',
  '2.4.6',
  '2.4.7',
  '2.4.11',
  '2.5.1',
  '2.5.2',
  '2.5.3',
  '2.5.4',
  '2.5.7',
  '2.5.8',
  '3.1.1',
  '3.1.2',
  '3.2.1',
  '3.2.2',
  '3.2.3',
  '3.2.4',
  '3.2.6',
  '3.3.1',
  '3.3.2',
  '3.3.3',
  '3.3.4',
  '3.3.7',
  '3.3.8',
  '4.1.2',
  '4.1.3',
]);

/**
 * The level A and AA criteria of WCAG 2.2 that no published ACT rule maps to, sorted.
 *
 * Computed from the vendored corpus rather than typed, so when the ACT-Rules Community
 * publishes a rule for one of them and the corpus is regenerated, it leaves this list
 * without anyone remembering to remove it.
 */
export const CRITERIA_WITHOUT_ACT_RULE: readonly string[] = Object.freeze(
  WCAG22_A_AA_CRITERIA.filter((c) => !allCoveredCriteria().includes(c)).sort(compareCriteria),
);
