import { describe, expect, it } from 'vitest';
import { computeCoverage } from './coverage.js';
import { allCoveredCriteria, compareCriteria, rulesForCriterion } from './rules.js';
import { CRITERIA_WITHOUT_ACT_RULE, WCAG22_A_AA_CRITERIA } from './wcag.js';

describe('the WCAG 2.2 level A and AA list', () => {
  it('has the 55 criteria WCAG 2.2 defines at A and AA, each once, in order', () => {
    expect(WCAG22_A_AA_CRITERIA).toHaveLength(55);
    expect(new Set(WCAG22_A_AA_CRITERIA).size).toBe(55);
    expect([...WCAG22_A_AA_CRITERIA].sort(compareCriteria)).toEqual(WCAG22_A_AA_CRITERIA);
  });

  it('leaves out 4.1.1 Parsing, which WCAG 2.2 removed', () => {
    expect(WCAG22_A_AA_CRITERIA).not.toContain('4.1.1');
  });

  it('includes the six criteria WCAG 2.2 added at A and AA', () => {
    for (const added of ['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8']) {
      expect(WCAG22_A_AA_CRITERIA).toContain(added);
    }
  });
});

describe('CRITERIA_WITHOUT_ACT_RULE', () => {
  it('names only criteria no published rule maps to', () => {
    for (const criterion of CRITERIA_WITHOUT_ACT_RULE) {
      expect(rulesForCriterion(criterion), criterion).toEqual([]);
    }
  });

  it('misses no A or AA criterion the corpus leaves uncovered', () => {
    const covered = new Set(allCoveredCriteria());
    const uncovered = WCAG22_A_AA_CRITERIA.filter((c) => !covered.has(c));
    expect(CRITERIA_WITHOUT_ACT_RULE).toEqual(uncovered);
  });

  // Pinned so a corpus regeneration that changes the list shows up as a reviewed diff,
  // not as a sentence on every report quietly getting shorter or longer.
  it('is the list the 2026-07-29 corpus produces', () => {
    expect(CRITERIA_WITHOUT_ACT_RULE).toEqual([
      '1.2.4',
      '1.3.2',
      '1.4.1',
      '1.4.11',
      '1.4.13',
      '2.2.2',
      '2.3.1',
      '2.4.3',
      '2.4.5',
      '2.4.11',
      '2.5.1',
      '2.5.2',
      '2.5.7',
      '2.5.8',
      '3.2.1',
      '3.2.2',
      '3.2.3',
      '3.2.4',
      '3.2.6',
      '3.3.2',
      '3.3.3',
      '3.3.4',
      '3.3.7',
      '3.3.8',
      '4.1.3',
    ]);
  });

  it('travels on every coverage figure, whatever was implemented', () => {
    const coverage = computeCoverage({ implemented: [], calibrated: [], notEvaluated: [] });
    expect(coverage.criteriaWithoutActRule).toEqual({
      of: 55,
      criteria: [...CRITERIA_WITHOUT_ACT_RULE],
    });
  });
});
