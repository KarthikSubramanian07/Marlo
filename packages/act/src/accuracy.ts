import type { StrictAccuracy } from '@marlo/schema';
import type { GradedCase } from './protocol.js';

/**
 * The strict view of accuracy: `cantTell` is not a detection.
 *
 * This is the other half of DECISIONS.md D-004, and the half a developer
 * experiences. The official protocol answers "did this tool mislead me". These
 * functions answer "will the violation be found, and does a clean report mean
 * clean".
 *
 * Held at 100 percent coverage in CI along with the protocol.
 */

/**
 * Confusion counts, treating `failed` as the positive class.
 *
 * The decisions worth stating, because each could reasonably have gone the other
 * way and the choice changes every published number:
 *
 * A failing example answered `cantTell` is a **false negative**. The violation was
 * there and the tool did not report it. Generous grading would call it a partial
 * credit, and a developer whose page ships broken did not receive partial credit.
 *
 * A passing example answered `cantTell` is **not a false positive**. The tool
 * asserted nothing, so it misled nobody. It lands in `cantTellOnPassed`, which is
 * reported as its own column: caution that costs nothing.
 *
 * That asymmetry is why `cantTellOnFailed` and `cantTellOnPassed` are both
 * published. Low recall from caution and low recall from incapacity look identical
 * in a single number, and telling them apart is the point of the table.
 *
 * `inapplicable` on a failing example is a false negative too: the rule decided it
 * had nothing to say about a subject the corpus says it fails on, which is a
 * missed violation whatever the mechanism.
 *
 * A case that never ran, `actual === null`, is excluded from every count. Counting
 * a crash as a miss would make an engine that throws look merely insensitive, and
 * counting it as a pass would be the sibling project's defect.
 */
export function strictAccuracyOf(cases: readonly GradedCase[]): StrictAccuracy {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;
  let cantTellOnFailed = 0;
  let cantTellOnPassed = 0;

  for (const graded of cases) {
    if (graded.actual === null) continue;

    if (graded.expected === 'failed') {
      if (graded.actual === 'failed') truePositives += 1;
      else {
        falseNegatives += 1;
        if (graded.actual === 'cantTell') cantTellOnFailed += 1;
      }
    } else {
      if (graded.actual === 'failed') falsePositives += 1;
      else {
        trueNegatives += 1;
        if (graded.actual === 'cantTell') cantTellOnPassed += 1;
      }
    }
  }

  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    cantTellOnFailed,
    cantTellOnPassed,
    precision,
    recall,
    f1: harmonicMean(precision, recall),
    falsePositiveRate: ratio(falsePositives, falsePositives + trueNegatives),
  };
}

/**
 * A rate, or null when the denominator is zero.
 *
 * Null rather than zero, deliberately and everywhere. Precision over zero
 * predictions is not zero precision, it is an absent measurement, and reporting it
 * as 0 would make an engine that never fires look maximally wrong instead of
 * silent. The same distinction is why `Confidence.precision` is nullable.
 */
export function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

/** Harmonic mean of two rates, or null if either is absent or both are zero. */
export function harmonicMean(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  if (a + b === 0) return 0;
  return (2 * a * b) / (a + b);
}

/**
 * Combines per-rule accuracy into one figure, weighted by test case count.
 *
 * Weighted rather than a mean of means. An unweighted average lets a rule with two
 * test cases move the headline number as much as a rule with twenty-nine, which is
 * how an aggregate becomes a number nobody can act on. The weighting is by the
 * counts that feed each rate, which is the same as pooling the confusion matrices.
 */
export function aggregateStrictAccuracy(entries: readonly StrictAccuracy[]): {
  readonly strictPrecision: number | null;
  readonly strictRecall: number | null;
  readonly falsePositiveRate: number | null;
  readonly sampleSize: number;
} {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (const entry of entries) {
    tp += entry.truePositives;
    fp += entry.falsePositives;
    fn += entry.falseNegatives;
    tn += entry.trueNegatives;
  }

  return {
    strictPrecision: ratio(tp, tp + fp),
    strictRecall: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn),
    sampleSize: tp + fp + fn + tn,
  };
}

/**
 * Whether a measurement is strong enough to permit auto-fixing.
 *
 * Precision rather than recall, because the two failures cost differently: a missed
 * violation is a gap the developer already had, and a wrong fix is a change to
 * their code that they did not ask for. The sample size floor exists because
 * precision of 1.0 over two examples is not evidence.
 *
 * Both values are policy rather than measurement, which is why they are arguments
 * here and configurable in `MarloConfig`, and why the calibration table records
 * the policy it was produced under alongside the numbers.
 */
export function meetsAutoFixThreshold(
  accuracy: StrictAccuracy,
  policy: { readonly minStrictPrecision: number; readonly minSampleSize: number },
): boolean {
  if (accuracy.precision === null) return false;
  const decisions = accuracy.truePositives + accuracy.falsePositives + accuracy.falseNegatives;
  if (decisions < policy.minSampleSize) return false;
  return accuracy.precision >= policy.minStrictPrecision;
}
