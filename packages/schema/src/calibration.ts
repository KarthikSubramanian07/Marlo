import { z } from 'zod';
import { frozenList, frozenRecord } from './freeze.js';
import type { ExpectedOutcome } from './primitives.js';
import { ActRuleId, EngineId, Outcome } from './primitives.js';

/**
 * The calibration table. The load-bearing artifact: every confidence score, every
 * routing decision, and every number on the website reads from this.
 *
 * The shape encodes DECISIONS.md D-004, which is the novel part of this project,
 * so it is worth restating here where the code is.
 *
 * W3C defines how to grade an implementation against a rule's official test
 * cases, in `pages/implementations/mapping.md` of the ACT rules repository:
 *
 *   Passed example        may return passed, cantTell or inapplicable
 *   Failed example        may return failed or cantTell
 *   Inapplicable example  may return inapplicable, cantTell or passed
 *
 * `cantTell` is allowed everywhere. A tool that returns `cantTell` on all 1134
 * test cases is, under the official protocol, a correct implementation of all 91
 * rules that have them.
 *
 * That is not a flaw. The protocol grades whether a tool misleads, and a tool
 * saying "I do not know" has not misled anyone. It is simply not the question a
 * developer is asking, which is whether the violation will be found and whether a
 * clean report means clean.
 *
 * So every entry carries both: `act`, the official verdict, comparable with
 * W3C's published implementation reports, and `strict`, where `cantTell` counts
 * as no detection. The gap between them is the interesting column and the one
 * most likely to embarrass Marlo, which is why it goes on the front page.
 */

/**
 * The official ACT grading verdict for one implementation of one rule.
 *
 *   consistent  an allowed outcome on every test case
 *   partial     every passed and inapplicable case correct, only some failed
 *   incorrect   at least one passed or inapplicable case wrong
 *   unmapped    the engine does not implement this rule at all. Distinct from
 *               `incorrect`, and conflating them would punish an engine for
 *               honestly having no opinion
 */
export const ActConsistency = z.enum(['consistent', 'partial', 'incorrect', 'unmapped']);
export type ActConsistency = z.infer<typeof ActConsistency>;

/**
 * Whether the implementation qualifies as automated under EARL's test modes.
 *
 * ACT derives this from whether any outcome was `cantTell`: automated means the
 * mode was automatic and nothing was `cantTell`; anything else with an automatic
 * mode is semi-automated. Recorded because "consistent and semi-automated" and
 * "consistent and automated" are very different products.
 */
export const AutomationLevel = z.enum(['automated', 'semi-automated', 'not-applicable']);
export type AutomationLevel = z.infer<typeof AutomationLevel>;

/**
 * How each expected outcome was answered. The raw counts, before any arithmetic.
 *
 * Published as counts rather than only as derived rates so that anyone disputing
 * a number can recompute it without rerunning the harness, and so that the
 * denominator of every rate is visible.
 */
export const OutcomeMatrix = z.object({
  /** Rows are what the test case expected, columns what the engine returned. */
  passed: z.record(Outcome, z.number().int().nonnegative()),
  failed: z.record(Outcome, z.number().int().nonnegative()),
  inapplicable: z.record(Outcome, z.number().int().nonnegative()),
  /** Test cases where the engine threw. Never folded into any other bucket. */
  errored: z.number().int().nonnegative(),
  /** Test cases the active renderer could not evaluate for this rule. */
  unsupported: z.number().int().nonnegative(),
});
export type OutcomeMatrix = z.infer<typeof OutcomeMatrix>;

/**
 * The strict view: `cantTell` is not a detection.
 *
 * A failing test case answered `cantTell` is a miss, not a partial credit. A
 * passing test case answered `cantTell` is not a false positive either, because
 * the engine did not assert a violation; it lands in `cantTellOnPassed` and shows
 * up as caution rather than error.
 */
export const StrictAccuracy = z.object({
  /** Failed examples correctly returned failed. */
  truePositives: z.number().int().nonnegative(),
  /** Passed or inapplicable examples wrongly returned failed. The false positives. */
  falsePositives: z.number().int().nonnegative(),
  /** Failed examples not returned as failed, including every cantTell. */
  falseNegatives: z.number().int().nonnegative(),
  /** Passed or inapplicable examples correctly not flagged. */
  trueNegatives: z.number().int().nonnegative(),

  /** cantTell on a failing example. Caution that costs recall. */
  cantTellOnFailed: z.number().int().nonnegative(),
  /** cantTell on a passing or inapplicable example. Caution that costs nothing. */
  cantTellOnPassed: z.number().int().nonnegative(),

  /** truePositives / (truePositives + falsePositives), or null when undefined. */
  precision: z.number().min(0).max(1).nullable(),
  /** truePositives / (truePositives + falseNegatives), or null when undefined. */
  recall: z.number().min(0).max(1).nullable(),
  /** Harmonic mean, or null when either input is null. */
  f1: z.number().min(0).max(1).nullable(),
  /** falsePositives / (falsePositives + trueNegatives). The published error rate. */
  falsePositiveRate: z.number().min(0).max(1).nullable(),
});
export type StrictAccuracy = z.infer<typeof StrictAccuracy>;

/**
 * One cell of the table: one engine's measured behaviour on one ACT rule.
 */
export const CalibrationEntry = z.object({
  actRuleId: ActRuleId,
  engine: EngineId,
  engineVersion: z.string().min(1),

  /** The engine's own rule identifiers that were mapped to this ACT rule. */
  engineRuleIds: z.array(z.string()).default([]),
  /** How the hand-written mapping characterises itself. See CONTRIBUTING.md. */
  mappingKind: z.enum(['exact', 'partial', 'superset', 'none']),

  /** How many official test cases this rule has. Zero means unmeasurable. */
  testCaseCount: z.number().int().nonnegative(),
  matrix: OutcomeMatrix,

  /** The official W3C verdict. */
  act: z.object({
    consistency: ActConsistency,
    automation: AutomationLevel,
    /** Test cases whose returned outcome the protocol does not allow. */
    disallowed: z.number().int().nonnegative(),
  }),

  /** What a user experiences. */
  strict: StrictAccuracy,

  /**
   * Whether the two views disagree in the direction that matters: the official
   * protocol says consistent while strict recall is poor. This is the column
   * nobody publishes, so it is computed rather than left for a reader to spot.
   */
  flatteredByProtocol: z.boolean(),
});
export type CalibrationEntry = z.infer<typeof CalibrationEntry>;

/** Which engine the router will use for a rule, and why. */
export const RoutingDecision = z
  .object({
    actRuleId: ActRuleId,
    chosen: EngineId.nullable(),
    reason: z.enum(['best-measured', 'sole-implementer', 'uncalibrated', 'no-implementer']),
    /** Engines that implement the rule at all, best first. */
    candidates: z.array(
      z.object({
        engine: EngineId,
        strictRecall: z.number().min(0).max(1).nullable(),
        strictPrecision: z.number().min(0).max(1).nullable(),
        consistency: ActConsistency,
      }),
    ),
    /** True when the chosen engine's measurement clears the auto-fix threshold. */
    autoFixPermitted: z.boolean(),
  })
  /*
   * Two reasons mean nobody was chosen, so they may not name an engine. This started as a
   * defensive branch in @marlo/report's decideRule, checking for a `no-implementer` routing
   * that also named an engine. No valid table can contain that, so the branch was a line no
   * test could reach, and an unreachable branch on a file the README says is fully covered is
   * either a false coverage claim or a state the schema should have forbidden.
   *
   * It was the second. Making the state unrepresentable deleted the branch.
   */
  .refine((r) => !(r.reason === 'no-implementer' && r.chosen !== null), {
    message: 'a rule nobody implements cannot have a chosen engine',
  })
  .refine((r) => !(r.reason === 'uncalibrated' && r.chosen !== null && r.candidates.length === 0), {
    message: 'an uncalibrated routing that names an engine must say which candidates it saw',
  });
export type RoutingDecision = z.infer<typeof RoutingDecision>;

/**
 * The whole table, as committed to `calibration/table.json`.
 *
 * Validated on load, every time. An unvalidated calibration table is how a
 * published error rate quietly becomes a different number.
 */
export const CalibrationTable = z.object({
  /** Bumped when the schema changes in a way a consumer must notice. */
  schemaVersion: z.literal(1),
  /** ISO date. Not a timestamp: the harness must be reproducible. */
  generated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The commit the harness ran at, or null when run from a dirty tree. */
  commit: z.string().nullable(),

  corpus: z.object({
    retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rules: z.number().int().positive(),
    rulesWithTestCases: z.number().int().positive(),
    testCases: z.number().int().positive(),
  }),

  engines: z.array(
    z.object({
      id: EngineId,
      version: z.string().min(1),
      /** How many ACT rules this engine has a mapping for. */
      mappedRules: z.number().int().nonnegative(),
    }),
  ),

  /** The renderer the measurement was taken with. A layout rule needs `browser`. */
  renderer: z.enum(['static', 'browser']),

  entries: z.array(CalibrationEntry),
  routing: z.array(RoutingDecision),

  /** The documented, tunable auto-fix policy value, and the reasoning for it. */
  autoFixThreshold: z.object({
    minStrictPrecision: z.number().min(0).max(1),
    minSampleSize: z.number().int().positive(),
    rationale: z.string().min(1),
  }),

  /**
   * Marlo's coverage, always as a fraction. There is no percentage field here on
   * purpose: a consumer that wants one has to divide, and will then have the
   * denominator in hand.
   */
  coverage: z.object({
    implemented: z.number().int().nonnegative(),
    publishedActRules: z.number().int().positive(),
    /** Of the implemented rules, how many could actually be measured. */
    calibratable: z.number().int().nonnegative(),
    /** Rules Marlo implements that have no official test cases, named. */
    implementedButUnmeasurable: z.array(ActRuleId).default([]),
  }),

  /**
   * The headline error rate, across every rule Marlo reports on. Asserted in CI,
   * and a regression fails the build.
   */
  aggregate: z.object({
    strictPrecision: z.number().min(0).max(1).nullable(),
    strictRecall: z.number().min(0).max(1).nullable(),
    falsePositiveRate: z.number().min(0).max(1).nullable(),
    /** Total official test cases the aggregate rests on. */
    sampleSize: z.number().int().nonnegative(),
  }),
});
export type CalibrationTable = z.infer<typeof CalibrationTable>;

/**
 * The official ACT allowed-outcome protocol, as data.
 *
 * Transcribed from `pages/implementations/mapping.md` in the ACT rules repository.
 * It lives here, in the vocabulary, so that @marlo/act and the calibration
 * harness cannot hold different opinions about what the protocol says.
 */
export const ACT_ALLOWED_OUTCOMES: Readonly<Record<ExpectedOutcome, readonly Outcome[]>> =
  frozenRecord<ExpectedOutcome, readonly Outcome[]>({
    passed: frozenList<Outcome>('passed', 'cantTell', 'inapplicable'),
    failed: frozenList<Outcome>('failed', 'cantTell'),
    inapplicable: frozenList<Outcome>('inapplicable', 'cantTell', 'passed'),
  });

/**
 * The threshold below which strict recall is considered poor enough that a
 * `consistent` verdict from the official protocol is flattering rather than
 * informative.
 *
 * 0.5 is a judgment, not a measurement, and it is here as a named constant rather
 * than inline so that disputing it is a one-line change with a visible diff. The
 * reasoning: below half, a developer who trusts a clean report is wrong more often
 * than not, which is the point at which "consistent" stops describing anything
 * they care about.
 */
export const FLATTERY_RECALL_THRESHOLD = 0.5;
