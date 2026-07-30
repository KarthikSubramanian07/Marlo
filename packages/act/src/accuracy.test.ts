import { describe, expect, it } from 'vitest';
import type { ExpectedOutcome, Outcome, StrictAccuracy } from '@marlo/schema';

import type { GradedCase } from './protocol.js';
import {
  aggregateStrictAccuracy,
  harmonicMean,
  meetsAutoFixThreshold,
  ratio,
  strictAccuracyOf,
} from './accuracy.js';

const graded = (expected: ExpectedOutcome, actual: Outcome | null): GradedCase => ({
  expected,
  actual,
});

describe('strictAccuracyOf', () => {
  it('counts a clean sweep correctly', () => {
    const a = strictAccuracyOf([
      graded('failed', 'failed'),
      graded('failed', 'failed'),
      graded('passed', 'passed'),
      graded('inapplicable', 'inapplicable'),
    ]);
    expect(a.truePositives).toBe(2);
    expect(a.falsePositives).toBe(0);
    expect(a.falseNegatives).toBe(0);
    expect(a.trueNegatives).toBe(2);
    expect(a.precision).toBe(1);
    expect(a.recall).toBe(1);
    expect(a.f1).toBe(1);
    expect(a.falsePositiveRate).toBe(0);
  });

  it('treats cantTell on a failing example as a miss', () => {
    // The decision that separates the strict view from the official protocol. A
    // developer whose page ships broken did not receive partial credit.
    const a = strictAccuracyOf([graded('failed', 'cantTell'), graded('failed', 'failed')]);
    expect(a.truePositives).toBe(1);
    expect(a.falseNegatives).toBe(1);
    expect(a.cantTellOnFailed).toBe(1);
    expect(a.recall).toBe(0.5);
  });

  it('does not treat cantTell on a passing example as a false positive', () => {
    // The tool asserted nothing, so it misled nobody. It lands in cantTellOnPassed,
    // which is caution that costs nothing, and precision is unaffected.
    const a = strictAccuracyOf([graded('passed', 'cantTell'), graded('failed', 'failed')]);
    expect(a.falsePositives).toBe(0);
    expect(a.trueNegatives).toBe(1);
    expect(a.cantTellOnPassed).toBe(1);
    expect(a.precision).toBe(1);
    expect(a.falsePositiveRate).toBe(0);
  });

  it('publishes both cantTell columns so caution and incapacity are distinguishable', () => {
    // Two engines with identical recall. One is cautious, the other simply cannot
    // do it. A single number cannot tell them apart, which is why both columns
    // exist.
    const cautious = strictAccuracyOf([graded('failed', 'cantTell'), graded('failed', 'failed')]);
    const incapable = strictAccuracyOf([graded('failed', 'passed'), graded('failed', 'failed')]);

    expect(cautious.recall).toBe(incapable.recall);
    expect(cautious.cantTellOnFailed).toBe(1);
    expect(incapable.cantTellOnFailed).toBe(0);
  });

  it('counts inapplicable on a failing example as a miss', () => {
    // The rule decided it had nothing to say about a subject the corpus says it
    // fails on. A missed violation, whatever the mechanism.
    const a = strictAccuracyOf([graded('failed', 'inapplicable')]);
    expect(a.falseNegatives).toBe(1);
    expect(a.cantTellOnFailed).toBe(0);
    expect(a.recall).toBe(0);
  });

  it('counts failed on a passing example as a false positive', () => {
    const a = strictAccuracyOf([graded('passed', 'failed'), graded('inapplicable', 'failed')]);
    expect(a.falsePositives).toBe(2);
    expect(a.trueNegatives).toBe(0);
    expect(a.precision).toBe(0);
    expect(a.falsePositiveRate).toBe(1);
  });

  it('excludes cases that never ran from every count', () => {
    // Counting a crash as a miss makes a throwing engine look merely insensitive.
    // Counting it as a pass is the sibling project's defect.
    const a = strictAccuracyOf([
      graded('failed', null),
      graded('passed', null),
      graded('failed', 'failed'),
    ]);
    expect(a.truePositives).toBe(1);
    expect(a.falseNegatives).toBe(0);
    expect(a.falsePositives).toBe(0);
    expect(a.trueNegatives).toBe(0);
    expect(a.recall).toBe(1);
  });

  it('returns null rather than zero for an undefined rate', () => {
    // Precision over zero predictions is not zero precision, it is an absent
    // measurement. Reporting it as 0 would make a silent engine look maximally
    // wrong.
    const neverFires = strictAccuracyOf([graded('passed', 'passed')]);
    expect(neverFires.precision).toBeNull();
    expect(neverFires.recall).toBeNull();
    expect(neverFires.f1).toBeNull();

    const nothingToMiss = strictAccuracyOf([graded('failed', 'failed')]);
    expect(nothingToMiss.falsePositiveRate).toBeNull();
  });

  it('returns nulls for no cases at all', () => {
    const empty = strictAccuracyOf([]);
    expect(empty.precision).toBeNull();
    expect(empty.recall).toBeNull();
    expect(empty.f1).toBeNull();
    expect(empty.falsePositiveRate).toBeNull();
    expect(empty.truePositives).toBe(0);
  });

  it('computes the false positive rate over negatives, not over everything', () => {
    // One false positive out of four negatives is 0.25, not 0.2 out of five cases.
    const a = strictAccuracyOf([
      graded('passed', 'failed'),
      graded('passed', 'passed'),
      graded('passed', 'passed'),
      graded('inapplicable', 'inapplicable'),
      graded('failed', 'failed'),
    ]);
    expect(a.falsePositives).toBe(1);
    expect(a.trueNegatives).toBe(3);
    expect(a.falsePositiveRate).toBe(0.25);
  });
});

describe('ratio', () => {
  it('divides', () => {
    expect(ratio(1, 4)).toBe(0.25);
    expect(ratio(0, 4)).toBe(0);
  });

  it('returns null for a zero denominator rather than zero or Infinity', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 0)).toBeNull();
  });
});

describe('harmonicMean', () => {
  it('is the usual F1', () => {
    expect(harmonicMean(1, 1)).toBe(1);
    expect(harmonicMean(0.5, 1)).toBeCloseTo(0.6667, 4);
  });

  it('is null when either input is absent', () => {
    expect(harmonicMean(null, 1)).toBeNull();
    expect(harmonicMean(1, null)).toBeNull();
    expect(harmonicMean(null, null)).toBeNull();
  });

  it('is zero rather than NaN when both are zero', () => {
    // 2*0*0 / (0+0) would be NaN, and NaN in a published table is worse than a
    // wrong number because it looks like a bug in the reader's code.
    expect(harmonicMean(0, 0)).toBe(0);
  });
});

describe('aggregateStrictAccuracy', () => {
  const entry = (
    truePositives: number,
    falsePositives: number,
    falseNegatives: number,
    trueNegatives: number,
  ): StrictAccuracy => ({
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    cantTellOnFailed: 0,
    cantTellOnPassed: 0,
    precision: null,
    recall: null,
    f1: null,
    falsePositiveRate: null,
  });

  it('pools the confusion matrices rather than averaging rates', () => {
    // An unweighted mean of means lets a rule with two test cases move the headline
    // number as much as a rule with twenty-nine, which is how an aggregate becomes
    // a figure nobody can act on.
    const small = entry(1, 0, 0, 1);
    const large = entry(10, 10, 0, 0);

    const pooled = aggregateStrictAccuracy([small, large]);
    // Pooled precision is 11/21, not the mean of 1.0 and 0.5, which would be 0.75.
    expect(pooled.strictPrecision).toBeCloseTo(11 / 21, 6);
    expect(pooled.strictPrecision).not.toBeCloseTo(0.75, 2);
    expect(pooled.sampleSize).toBe(22);
  });

  it('is all nulls for no entries', () => {
    const empty = aggregateStrictAccuracy([]);
    expect(empty.strictPrecision).toBeNull();
    expect(empty.strictRecall).toBeNull();
    expect(empty.falsePositiveRate).toBeNull();
    expect(empty.sampleSize).toBe(0);
  });

  it('reports the sample size the aggregate rests on', () => {
    expect(aggregateStrictAccuracy([entry(2, 1, 3, 4)]).sampleSize).toBe(10);
  });
});

describe('meetsAutoFixThreshold', () => {
  const policy = { minStrictPrecision: 0.95, minSampleSize: 6 };

  const withPrecision = (
    truePositives: number,
    falsePositives: number,
    falseNegatives: number,
  ): StrictAccuracy => {
    const precision =
      truePositives + falsePositives === 0
        ? null
        : truePositives / (truePositives + falsePositives);
    return {
      truePositives,
      falsePositives,
      falseNegatives,
      trueNegatives: 0,
      cantTellOnFailed: 0,
      cantTellOnPassed: 0,
      precision,
      recall: null,
      f1: null,
      falsePositiveRate: null,
    };
  };

  it('permits a fix when precision and sample size both clear the bar', () => {
    expect(meetsAutoFixThreshold(withPrecision(10, 0, 0), policy)).toBe(true);
  });

  it('refuses on precision alone, however large the sample', () => {
    // Precision rather than recall, because the two failures cost differently: a
    // missed violation is a gap the developer already had, and a wrong fix is a
    // change to their code they did not ask for.
    expect(meetsAutoFixThreshold(withPrecision(90, 10, 0), policy)).toBe(false);
  });

  it('refuses a perfect score over too few examples', () => {
    // Precision of 1.0 over two examples is not evidence.
    expect(meetsAutoFixThreshold(withPrecision(2, 0, 0), policy)).toBe(false);
    expect(meetsAutoFixThreshold(withPrecision(6, 0, 0), policy)).toBe(true);
  });

  it('counts misses toward the sample size', () => {
    // A rule that fires correctly twice and misses four times has been exercised
    // six times. Excluding misses would let a rule with almost no true positives
    // qualify on a tiny number of confident firings.
    expect(meetsAutoFixThreshold(withPrecision(2, 0, 4), policy)).toBe(true);
  });

  it('refuses when precision was never measured', () => {
    expect(meetsAutoFixThreshold(withPrecision(0, 0, 0), policy)).toBe(false);
  });

  it('honours a policy the caller changed', () => {
    // Both values are policy rather than measurement, which is why they are
    // arguments and why the table records the policy it was produced under.
    const lenient = { minStrictPrecision: 0.8, minSampleSize: 2 };
    expect(meetsAutoFixThreshold(withPrecision(9, 1, 0), policy)).toBe(false);
    expect(meetsAutoFixThreshold(withPrecision(9, 1, 0), lenient)).toBe(true);
  });
});
