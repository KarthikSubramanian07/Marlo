import type { Capability, Coverage } from '@marlo/schema';
import { PUBLISHED_ACT_RULE_COUNT, findRule } from './rules.js';

/**
 * Coverage arithmetic.
 *
 * One function, because coverage is the number most likely to be overstated and
 * the point of having a single computation is that there is one place to audit.
 * `formatCoverage` in @marlo/schema is the only sanctioned way to render the
 * result, and it never produces a percentage.
 */

export interface CoverageInput {
  /** ACT rule identifiers Marlo implements. Unknown ids are rejected, not ignored. */
  readonly implemented: readonly string[];
  /** Of those, which were actually measured against official test cases. */
  readonly calibrated: readonly string[];
  /** Rules requested but not evaluated, with what the renderer was missing. */
  readonly notEvaluated: readonly {
    readonly actRuleId: string;
    readonly missing: readonly Capability[];
  }[];
}

/**
 * Thrown when a coverage claim names a rule the published corpus does not contain.
 *
 * A hard error rather than a filtered-out entry. Silently dropping an unknown
 * identifier would let a typo shrink the numerator without anyone noticing, and
 * silently counting it would let Marlo claim coverage of a rule that does not
 * exist. Both are worse than a failed build.
 */
export class UnknownRuleError extends Error {
  readonly actRuleId: string;

  constructor(actRuleId: string) {
    super(
      `"${actRuleId}" is not a published ACT rule. Coverage may only be claimed for rules in ` +
        'the vendored corpus. If the corpus is out of date, regenerate it with `pnpm corpus:fetch`.',
    );
    this.name = 'UnknownRuleError';
    this.actRuleId = actRuleId;
  }
}

/**
 * Builds the coverage figure.
 *
 * Two invariants are checked rather than assumed, because both are ways a coverage
 * claim goes wrong quietly:
 *
 *   Every identifier names a published rule.
 *   Every calibrated rule is also an implemented one. Claiming a measurement for a
 *   rule Marlo does not implement would be measuring a peer engine and reporting it
 *   as coverage.
 */
export function computeCoverage(input: CoverageInput): Coverage {
  const implemented = [...new Set(input.implemented)].sort();
  const calibrated = [...new Set(input.calibrated)].sort();

  // Resolved to records rather than validated and then looked up again. Looking
  // twice would leave an `undefined` branch that validation has already made
  // unreachable, and an unreachable branch in the module that computes the
  // coverage denominator is a branch nobody can test.
  const implementedRules = implemented.map((id) => {
    const rule = findRule(id);
    if (rule === undefined) throw new UnknownRuleError(id);
    return rule;
  });

  const implementedSet = new Set(implemented);
  for (const id of calibrated) {
    if (findRule(id) === undefined) throw new UnknownRuleError(id);
    if (!implementedSet.has(id)) {
      throw new Error(
        `"${id}" is listed as calibrated but not as implemented. A measurement for a rule Marlo ` +
          'does not implement is a measurement of a peer engine, not coverage.',
      );
    }
  }

  // Implemented rules with no official test cases. Named rather than omitted:
  // leaving them out overstates coverage, and counting them as calibrated
  // overstates accuracy.
  const unmeasurable = implementedRules.filter((r) => r.testCases.total === 0).map((r) => r.id);

  return {
    implemented: implemented.length,
    publishedActRules: PUBLISHED_ACT_RULE_COUNT,
    calibrated: calibrated.length,
    unmeasurable,
    notEvaluated: input.notEvaluated.map((n) => ({
      actRuleId: n.actRuleId,
      missing: [...n.missing],
    })),
  };
}

/**
 * The gap, stated as the sentence the README uses.
 *
 * Exists so the backlog count in CONTRIBUTING cannot drift from the registry. The
 * sibling project has the same test, and it is the reason its README could not
 * quietly start implying completeness.
 */
export function describeGap(coverage: Coverage): string {
  const remaining = coverage.publishedActRules - coverage.implemented;
  return `${String(remaining)} of ${String(coverage.publishedActRules)} published ACT rules are not yet implemented`;
}
