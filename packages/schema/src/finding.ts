import { z } from 'zod';
import {
  ActRuleId,
  Capability,
  DomTarget,
  EngineId,
  Outcome,
  RendererId,
  RuleStatus,
  Severity,
  SourceRange,
  SuccessCriterion,
} from './primitives.js';

/**
 * What an engine said, what Marlo concluded, and who disagreed.
 *
 * The shape here is the one that makes routing possible. A finding is not "a
 * problem"; it is one engine's verdict on one ACT rule applied to one target,
 * with the engine named. Marlo then chooses which verdict to report and records
 * the ones it did not choose, rather than unioning them all and calling that
 * comprehensive. See DECISIONS.md D-003.
 */

/**
 * One engine's verdict on one target for one ACT rule.
 *
 * `engineRuleId` is kept alongside `actRuleId` because the mapping between them
 * is hand-written and sometimes partial, so a reader auditing a mapping needs to
 * see what the engine actually called it. No engine publishes this mapping;
 * writing it is the work. See RESEARCH.md §2.
 */
export const EngineVerdict = z.object({
  engine: EngineId,
  engineVersion: z.string().min(1),
  /** The engine's own identifier for the check that produced this. */
  engineRuleId: z.string().min(1),
  actRuleId: ActRuleId,
  outcome: Outcome,
  target: DomTarget,
  /** The engine's own message, verbatim. Not rewritten: it is evidence. */
  message: z.string(),
});
export type EngineVerdict = z.infer<typeof EngineVerdict>;

/**
 * A disagreement worth recording.
 *
 * Both directions matter. A peer reporting `failed` where the router's chosen
 * engine reported `passed` triggers the one-directional invariant: Marlo may not
 * report clean, and may only dissent explicitly. A peer reporting `passed` where
 * the chosen engine failed is weaker evidence but still evidence, and it is what
 * a false positive report usually turns out to be.
 */
export const Disagreement = z.object({
  engine: EngineId,
  engineRuleId: z.string().min(1),
  outcome: Outcome,
  message: z.string(),
  /**
   * The chosen engine's measured strict recall for this rule, so a reader can
   * see why the router preferred it over the dissenter rather than taking the
   * routing decision on trust.
   */
  chosenEngineStrictRecall: z.number().min(0).max(1).nullable(),
});
export type Disagreement = z.infer<typeof Disagreement>;

/**
 * Confidence, and where it came from.
 *
 * `source` is the honest part. `calibrated` means the number was read out of
 * `calibration/table.json`. `uncalibrated` means the rule has no official test
 * cases, so nobody has measured it: three ACT rules are in that position and the
 * table has to say so rather than leave a blank that reads as a zero.
 */
export const Confidence = z.object({
  source: z.enum(['calibrated', 'uncalibrated']),
  /** Strict precision for the reporting engine on this rule, or null if unmeasured. */
  precision: z.number().min(0).max(1).nullable(),
  /** Strict recall for the reporting engine on this rule, or null if unmeasured. */
  recall: z.number().min(0).max(1).nullable(),
  /** How many official test cases the measurement rests on. Zero means it does not. */
  sampleSize: z.number().int().nonnegative(),
  /** True when the calibration data clears the documented auto-fix threshold. */
  meetsAutoFixThreshold: z.boolean(),
});
export type Confidence = z.infer<typeof Confidence>;

/**
 * A finding Marlo is reporting: one ACT rule, one target, one chosen engine, with
 * every dissent attached.
 */
export const Finding = z.object({
  id: z.string().min(1),
  actRuleId: ActRuleId,
  actRuleName: z.string().min(1),
  successCriteria: z.array(SuccessCriterion),
  severity: Severity,

  /** Which engine's verdict is being reported, and why it was chosen. */
  reportedBy: EngineId,
  routingReason: z.enum([
    /** Highest measured strict recall among engines implementing this rule. */
    'best-measured',
    /** The only engine implementing this rule. */
    'sole-implementer',
    /**
     * No engine has measured accuracy for this rule, so the finding carries no
     * accuracy claim at all.
     */
    'uncalibrated',
    /**
     * Reported because a peer failed and the chosen engine did not. The
     * one-directional invariant forbids reporting clean in that case.
     */
    'invariant',
  ]),

  verdict: EngineVerdict,
  agreedBy: z.array(EngineId).default([]),
  disagreements: z.array(Disagreement).default([]),
  confidence: Confidence,

  /**
   * Where this is in source, if it could be located exactly. Null means it could
   * not be, which is a first-class outcome rather than a failure: guessing which
   * component prop to change is how a tool edits twenty call sites to fix one.
   */
  source: SourceRange.nullable(),
  /** Why source location failed, when it did. Shown to the reader. */
  locationNote: z.string().nullable(),

  renderer: RendererId,
  help: z.string(),
  helpUrl: z.url(),
});
export type Finding = z.infer<typeof Finding>;

/**
 * The result of evaluating one ACT rule with one engine over one page.
 *
 * `status` is why this type exists rather than a bare array of verdicts. A rule
 * that threw and a rule that found nothing are different facts, and collapsing
 * them is how the sibling project's auditor reported success on documents it had
 * broken.
 */
export const RuleResult = z.object({
  actRuleId: ActRuleId,
  engine: EngineId,
  status: RuleStatus,
  /** Empty when status is not `ok`. */
  verdicts: z.array(EngineVerdict).default([]),
  /** Present when status is `error`. The message, not a stack. */
  error: z.string().nullable().default(null),
  /** Present when status is `unsupported`: what the rule needed and did not get. */
  missingCapabilities: z.array(Capability).default([]),
  durationMs: z.number().nonnegative(),
});
export type RuleResult = z.infer<typeof RuleResult>;

/**
 * Everything one engine produced for one page.
 *
 * Validated on the way in, because an engine is a trust boundary. axe-core, Alfa
 * and HTML CodeSniffer are third-party code producing shapes their own tests
 * cover and Marlo's do not.
 */
export const EngineReport = z.object({
  engine: EngineId,
  engineVersion: z.string().min(1),
  renderer: RendererId,
  results: z.array(RuleResult),
  /**
   * Rules this engine implements but which were not requested. Recorded so a
   * reader can tell a rule that was skipped from a rule the engine cannot do.
   */
  notRequested: z.array(ActRuleId).default([]),
  durationMs: z.number().nonnegative(),
});
export type EngineReport = z.infer<typeof EngineReport>;

/**
 * The highest severity in a set of findings, or null for none.
 *
 * Exported rather than inlined at each call site because "what is the worst thing
 * here" decides the CLI exit code, the Action's pass or fail, and the ordering of
 * the pull request body, and those three must never disagree.
 */
export function worstSeverity(findings: readonly { severity: Severity }[]): Severity | null {
  const order: readonly Severity[] = ['advisory', 'moderate', 'serious', 'critical'];
  let worst: Severity | null = null;
  for (const finding of findings) {
    if (worst === null || order.indexOf(finding.severity) > order.indexOf(worst)) {
      worst = finding.severity;
    }
  }
  return worst;
}
