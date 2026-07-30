import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ACT_RULES, CORPUS_RETRIEVED } from './rules.generated.js';
import {
  MEASURABLE_ACT_RULES,
  PUBLISHED_ACT_RULE_COUNT,
  UNMEASURABLE_ACT_RULES,
  allCoveredCriteria,
  compareCriteria,
  findRule,
  isPublishedRule,
  rulesForCriterion,
} from './rules.js';
import { UnknownRuleError, computeCoverage, describeGap } from './coverage.js';

/**
 * @marlo/act is a pure package and its production code touches no filesystem,
 * asserted by dependency-cruiser. This test file is the one narrow exception, and
 * it exists for a specific reason: rules.generated.ts is generated from
 * corpus/act/MANIFEST.json, and the only thing standing between the two is a check
 * that they agree. Reading the manifest here is what makes that check real rather
 * than a comment in the generator.
 *
 * The dependency rule has a pathNot for test files, with this reasoning attached.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

interface ManifestRule {
  readonly id: string;
  readonly name: string;
  readonly ruleType: string;
  readonly requirements: readonly string[];
  readonly inputAspects: readonly string[];
  readonly testCases: { passed: number; failed: number; inapplicable: number };
}

interface Manifest {
  readonly retrieved: string;
  readonly totals: {
    readonly rules: number;
    readonly rulesWithTestCases: number;
    readonly testCases: number;
  };
  readonly rules: readonly ManifestRule[];
}

const manifest: Manifest = JSON.parse(
  readFileSync(resolve(ROOT, 'corpus/act/MANIFEST.json'), 'utf8'),
);

describe('the generated index agrees with the corpus', () => {
  it('has the same number of rules', () => {
    expect(PUBLISHED_ACT_RULE_COUNT).toBe(manifest.totals.rules);
    expect(ACT_RULES).toHaveLength(manifest.totals.rules);
  });

  it('records the same retrieval date', () => {
    expect(CORPUS_RETRIEVED).toBe(manifest.retrieved);
  });

  it('agrees field by field with every rule in the manifest', () => {
    // Not a spot check. Every rule, every field, because a generator that is right
    // about 93 of 94 rules is a generator nobody will notice is wrong.
    for (const source of manifest.rules) {
      const generated = findRule(source.id);
      expect(generated, `rule ${source.id} is missing from the generated index`).toBeDefined();
      if (generated === undefined) continue;

      expect(generated.name).toBe(source.name);
      expect(generated.ruleType).toBe(source.ruleType);
      expect(generated.inputAspects).toEqual(source.inputAspects);
      expect(generated.testCases.passed).toBe(source.testCases.passed);
      expect(generated.testCases.failed).toBe(source.testCases.failed);
      expect(generated.testCases.inapplicable).toBe(source.testCases.inapplicable);
      expect(generated.testCases.total).toBe(
        source.testCases.passed + source.testCases.failed + source.testCases.inapplicable,
      );

      // Success criteria are extracted from requirement keys like `wcag20:1.3.1`.
      const expectedCriteria = [
        ...new Set(
          source.requirements
            .map((r) => /^wcag\d+:(\d+\.\d+\.\d+)$/.exec(r)?.[1])
            .filter((c): c is string => c !== undefined),
        ),
      ].sort();
      expect(generated.successCriteria).toEqual(expectedCriteria);
    }
  });

  it('preserves non-WCAG requirements rather than dropping them', () => {
    // Techniques, ARIA terms and European Accessibility Act references are not
    // routable, but discarding them would make a rule appear to map to fewer
    // requirements than it does.
    const totalOther = ACT_RULES.reduce((sum, r) => sum + r.otherRequirements.length, 0);
    const manifestOther = manifest.rules.reduce(
      (sum, r) => sum + r.requirements.filter((q) => !/^wcag\d+:\d+\.\d+\.\d+$/.test(q)).length,
      0,
    );
    expect(totalOther).toBe(manifestOther);
    expect(totalOther).toBeGreaterThan(0);
  });

  it('splits measurable from unmeasurable the way the corpus does', () => {
    expect(MEASURABLE_ACT_RULES).toHaveLength(manifest.totals.rulesWithTestCases);
    expect(UNMEASURABLE_ACT_RULES).toHaveLength(
      manifest.totals.rules - manifest.totals.rulesWithTestCases,
    );
    // Every unmeasurable rule really has no test cases, rather than being an
    // omission from the generator.
    for (const id of UNMEASURABLE_ACT_RULES) {
      expect(findRule(id)?.testCases.total).toBe(0);
    }
  });

  it('accounts for every test case in the corpus', () => {
    const counted = ACT_RULES.reduce((sum, r) => sum + r.testCases.total, 0);
    expect(counted).toBe(manifest.totals.testCases);
  });
});

describe('the index is trustworthy on its own terms', () => {
  it('has unique identifiers', () => {
    const ids = ACT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is sorted, so a regenerated file diffs cleanly', () => {
    const ids = ACT_RULES.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('uses well-formed identifiers throughout', () => {
    for (const rule of ACT_RULES) {
      expect(rule.id, `${rule.id} is not a six-character ACT identifier`).toMatch(/^[a-z0-9]{6}$/);
    }
  });

  it('uses well-formed success criteria throughout', () => {
    for (const rule of ACT_RULES) {
      for (const criterion of rule.successCriteria) {
        expect(criterion, `${rule.id} has criterion ${criterion}`).toMatch(/^\d+\.\d+\.\d+$/);
      }
    }
  });

  it('is frozen at both levels, so a consumer cannot mutate the denominator', () => {
    expect(Object.isFrozen(ACT_RULES)).toBe(true);
    expect(Object.isFrozen(ACT_RULES[0])).toBe(true);
    expect(Object.isFrozen(ACT_RULES[0]?.successCriteria)).toBe(true);
  });

  it('only has atomic and composite rule types', () => {
    for (const rule of ACT_RULES) {
      expect(['atomic', 'composite']).toContain(rule.ruleType);
    }
  });
});

describe('lookups', () => {
  it('finds a known rule and returns undefined for an unknown one', () => {
    expect(findRule('b5c3f8')?.name).toBe('HTML page has lang attribute');
    expect(findRule('zzzzzz')).toBeUndefined();
    expect(isPublishedRule('b5c3f8')).toBe(true);
    expect(isPublishedRule('zzzzzz')).toBe(false);
  });

  it('finds every rule touching a criterion', () => {
    const langRules = rulesForCriterion('3.1.1');
    expect(langRules.length).toBeGreaterThan(1);
    expect(langRules.map((r) => r.id)).toContain('b5c3f8');
    for (const rule of langRules) {
      expect(rule.successCriteria).toContain('3.1.1');
    }
  });

  it('returns nothing for a criterion no rule maps to', () => {
    expect(rulesForCriterion('9.9.9')).toEqual([]);
  });

  it('lists every criterion any rule covers, in numeric order', () => {
    const criteria = allCoveredCriteria();
    expect(criteria.length).toBeGreaterThan(20);
    expect(criteria).toEqual([...criteria].sort(compareCriteria));
    // The specific case a string sort gets wrong.
    if (criteria.includes('1.4.9') && criteria.includes('1.4.10')) {
      expect(criteria.indexOf('1.4.9')).toBeLessThan(criteria.indexOf('1.4.10'));
    }
  });
});

describe('compareCriteria', () => {
  it('orders numerically rather than lexically', () => {
    // '1.4.10' < '1.4.9' as strings, which would put 1.4.10 first and read as a bug
    // to anyone scanning the list.
    expect(compareCriteria('1.4.9', '1.4.10')).toBeLessThan(0);
    expect(compareCriteria('1.4.10', '1.4.9')).toBeGreaterThan(0);
    expect(compareCriteria('2.1.1', '1.4.13')).toBeGreaterThan(0);
    expect(compareCriteria('1.1.1', '1.1.1')).toBe(0);
  });

  it('treats a missing component as zero, in both directions', () => {
    expect(compareCriteria('1.4', '1.4.1')).toBeLessThan(0);
    expect(compareCriteria('1.4.1', '1.4')).toBeGreaterThan(0);
    expect(compareCriteria('1.4', '1.4')).toBe(0);
  });
});

describe('computeCoverage', () => {
  it('states the fraction with the real denominator', () => {
    const coverage = computeCoverage({
      implemented: ['b5c3f8', 'bf051a', 'c487ae'],
      calibrated: ['b5c3f8', 'bf051a', 'c487ae'],
      notEvaluated: [],
    });
    expect(coverage.implemented).toBe(3);
    expect(coverage.publishedActRules).toBe(PUBLISHED_ACT_RULE_COUNT);
    expect(coverage.calibrated).toBe(3);
  });

  it('deduplicates rather than double-counting', () => {
    const coverage = computeCoverage({
      implemented: ['b5c3f8', 'b5c3f8'],
      calibrated: [],
      notEvaluated: [],
    });
    expect(coverage.implemented).toBe(1);
  });

  it('throws on an identifier the corpus does not contain', () => {
    // A hard error rather than a filtered entry. Dropping an unknown id lets a typo
    // shrink the numerator unnoticed; counting it lets Marlo claim coverage of a
    // rule that does not exist.
    expect(() =>
      computeCoverage({ implemented: ['zzzzzz'], calibrated: [], notEvaluated: [] }),
    ).toThrow(UnknownRuleError);
    expect(() =>
      computeCoverage({ implemented: [], calibrated: ['zzzzzz'], notEvaluated: [] }),
    ).toThrow(UnknownRuleError);
  });

  it('carries the offending identifier on the error', () => {
    try {
      computeCoverage({ implemented: ['zzzzzz'], calibrated: [], notEvaluated: [] });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownRuleError);
      if (error instanceof UnknownRuleError) expect(error.actRuleId).toBe('zzzzzz');
    }
  });

  it('refuses a calibrated rule that is not implemented', () => {
    // That would be a measurement of a peer engine reported as Marlo's coverage.
    expect(() =>
      computeCoverage({ implemented: ['b5c3f8'], calibrated: ['c487ae'], notEvaluated: [] }),
    ).toThrow(/not as implemented/);
  });

  it('names implemented rules that cannot be measured', () => {
    const unmeasurable = UNMEASURABLE_ACT_RULES[0];
    expect(unmeasurable).toBeDefined();
    if (unmeasurable === undefined) return;

    const coverage = computeCoverage({
      implemented: ['b5c3f8', unmeasurable],
      calibrated: ['b5c3f8'],
      notEvaluated: [],
    });
    expect(coverage.implemented).toBe(2);
    expect(coverage.calibrated).toBe(1);
    expect(coverage.unmeasurable).toEqual([unmeasurable]);
  });

  it('carries rules the renderer could not evaluate', () => {
    const coverage = computeCoverage({
      implemented: ['afw4f7'],
      calibrated: [],
      notEvaluated: [{ actRuleId: 'afw4f7', missing: ['layout'] }],
    });
    expect(coverage.notEvaluated).toEqual([{ actRuleId: 'afw4f7', missing: ['layout'] }]);
  });

  it('handles claiming nothing', () => {
    const coverage = computeCoverage({ implemented: [], calibrated: [], notEvaluated: [] });
    expect(coverage.implemented).toBe(0);
    expect(coverage.publishedActRules).toBe(PUBLISHED_ACT_RULE_COUNT);
    expect(coverage.unmeasurable).toEqual([]);
  });
});

describe('describeGap', () => {
  it('states what is left, which is what the backlog has to agree with', () => {
    const coverage = computeCoverage({
      implemented: ['b5c3f8'],
      calibrated: ['b5c3f8'],
      notEvaluated: [],
    });
    expect(describeGap(coverage)).toBe(
      `${String(PUBLISHED_ACT_RULE_COUNT - 1)} of ${String(PUBLISHED_ACT_RULE_COUNT)} published ACT rules are not yet implemented`,
    );
  });
});
