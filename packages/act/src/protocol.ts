import type { ActConsistency, AutomationLevel, ExpectedOutcome, Outcome } from '@marlo/schema';
import { ACT_ALLOWED_OUTCOMES } from '@marlo/schema';

/**
 * The official W3C grading protocol, implemented.
 *
 * Source: `pages/implementations/mapping.md` in `act-rules/act-rules.github.io`.
 * The allowed-outcome table itself lives in @marlo/schema as frozen data, so this
 * module and the calibration harness cannot hold different opinions about what the
 * protocol says.
 *
 * Everything here is arithmetic over a list of graded test cases. Held at 100
 * percent coverage in CI, because every accuracy number Marlo publishes is
 * computed by these functions and a partly covered grading protocol means an
 * unmeasured accuracy claim.
 */

/** One official test case, and what an implementation returned for it. */
export interface GradedCase {
  /** What the corpus says the answer is. */
  readonly expected: ExpectedOutcome;
  /**
   * What the implementation returned, or null if it never ran: it crashed, or the
   * renderer could not provide a capability the rule needs. Null is never folded
   * into any outcome bucket.
   */
  readonly actual: Outcome | null;
  /** True when the implementation threw rather than declining. */
  readonly errored?: boolean;
  /** True when the renderer could not evaluate the rule. */
  readonly unsupported?: boolean;
}

/**
 * Does the protocol permit this answer for this test case?
 *
 * A null actual is never permitted. The protocol has no entry for "did not run",
 * because it assumes a tool that was asked a question gave an answer; treating a
 * crash as permitted would let a broken implementation grade as consistent.
 */
export function isAllowed(expected: ExpectedOutcome, actual: Outcome | null): boolean {
  if (actual === null) return false;
  return ACT_ALLOWED_OUTCOMES[expected].includes(actual);
}

/**
 * The official verdict for one implementation of one rule.
 *
 * The protocol's three categories, plus `unmapped` for an implementation that does
 * not claim the rule at all.
 *
 *   consistent  every test case returned an allowed outcome
 *   partial     every passed and inapplicable case allowed, only some failed cases
 *   incorrect   at least one passed or inapplicable case disallowed
 *   unmapped    nothing was evaluated, because nothing was claimed
 *
 * The distinction between `partial` and `incorrect` is the protocol's, and it is
 * asymmetric on purpose: getting a failing example wrong is a miss, and getting a
 * passing example wrong is a false positive. The protocol treats the second as
 * disqualifying and the first as incomplete, which matches how the two cost a
 * developer.
 */
export function consistencyOf(cases: readonly GradedCase[]): ActConsistency {
  if (cases.length === 0) return 'unmapped';

  let allNegativesAllowed = true;
  let allPositivesAllowed = true;

  for (const graded of cases) {
    const allowed = isAllowed(graded.expected, graded.actual);
    if (graded.expected === 'failed') {
      if (!allowed) allPositivesAllowed = false;
    } else if (!allowed) {
      allNegativesAllowed = false;
    }
  }

  if (!allNegativesAllowed) return 'incorrect';
  if (!allPositivesAllowed) return 'partial';
  return 'consistent';
}

/**
 * Whether the implementation is automated in EARL's sense.
 *
 * ACT derives this from `cantTell`: an automatic-mode implementation with no
 * `cantTell` outcome is automated, and anything else is semi-automated. Recorded
 * because "consistent and semi-automated" and "consistent and automated" describe
 * very different products, and the official reports publish only the first word.
 */
export function automationOf(cases: readonly GradedCase[]): AutomationLevel {
  if (cases.length === 0) return 'not-applicable';
  return cases.some((c) => c.actual === 'cantTell') ? 'semi-automated' : 'automated';
}

/**
 * How many test cases returned an outcome the protocol does not allow.
 *
 * Published alongside the verdict because `incorrect` on one case out of thirty
 * and `incorrect` on twenty-nine are the same word.
 */
export function disallowedCount(cases: readonly GradedCase[]): number {
  return cases.filter((c) => !isAllowed(c.expected, c.actual)).length;
}

/**
 * True when the official protocol flatters the implementation.
 *
 * The finding behind DECISIONS.md D-004: `cantTell` is an allowed outcome for
 * every example type, so an implementation returning `cantTell` everywhere grades
 * as `consistent` while telling a developer nothing. That combination is computed
 * here rather than left for a reader to notice, because a reader who has to spot
 * it will not.
 *
 * `strictRecall` is the recall from the strict view, where `cantTell` is not a
 * detection. Null means recall was undefined, which happens when the rule has no
 * failing examples; that is not flattery, it is an absent measurement.
 */
export function isFlatteredByProtocol(
  consistency: ActConsistency,
  strictRecall: number | null,
  threshold: number,
): boolean {
  if (consistency !== 'consistent') return false;
  if (strictRecall === null) return false;
  return strictRecall < threshold;
}

/**
 * Counts of every outcome per expected category, plus the two buckets that must
 * never be folded into an outcome.
 *
 * Returned as counts rather than only as rates so anyone disputing a published
 * number can recompute it without rerunning the harness, and so the denominator of
 * every rate is visible.
 */
export function outcomeMatrixOf(cases: readonly GradedCase[]): {
  readonly passed: Record<Outcome, number>;
  readonly failed: Record<Outcome, number>;
  readonly inapplicable: Record<Outcome, number>;
  readonly errored: number;
  readonly unsupported: number;
} {
  const empty = (): Record<Outcome, number> => ({
    passed: 0,
    failed: 0,
    cantTell: 0,
    inapplicable: 0,
  });
  const matrix = {
    passed: empty(),
    failed: empty(),
    inapplicable: empty(),
    errored: 0,
    unsupported: 0,
  };

  for (const graded of cases) {
    if (graded.errored === true) matrix.errored += 1;
    if (graded.unsupported === true) matrix.unsupported += 1;
    if (graded.actual === null) continue;
    matrix[graded.expected][graded.actual] += 1;
  }

  return matrix;
}
