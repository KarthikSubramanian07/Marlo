import { z } from 'zod';
import { ActRuleId, EngineId } from './primitives.js';

/**
 * The analysis behind the calibration table, as committed to `calibration/analysis.json`.
 *
 * The table grades each engine on each rule, and its routing is chosen from those same
 * grades. That makes any figure for "the engine the router picked" an in-sample figure:
 * the router is scored on the test cases it was fitted to, and it excludes every engine
 * that flagged a passing case, so a routed precision of 1.000 is partly true by
 * construction. This artifact holds the figures that answer the questions the table cannot:
 * what routing achieves on cases it has not seen, what `marlo scan` actually reports, how
 * certain each proportion is, and how much the engines agree.
 *
 * Every figure here is deterministic. There is no sampling and no seed, so `--check` can
 * compare a regenerated analysis with the committed one exactly.
 */

/** A proportion with its Wilson score interval at 95 percent, or null when undefined. */
export const Proportion = z
  .object({
    value: z.number().min(0).max(1),
    low: z.number().min(0).max(1),
    high: z.number().min(0).max(1),
    successes: z.number().int().nonnegative(),
    trials: z.number().int().positive(),
  })
  .refine((p) => p.low <= p.value && p.value <= p.high, {
    message: 'an interval must contain its estimate',
  });
export type Proportion = z.infer<typeof Proportion>;

/** One way of deciding a test case, scored strictly: cantTell is no detection. */
export const StrategyScore = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** What the strategy is, in a sentence a reader can check against the code. */
  description: z.string().min(1),
  truePositives: z.number().int().nonnegative(),
  falsePositives: z.number().int().nonnegative(),
  falseNegatives: z.number().int().nonnegative(),
  trueNegatives: z.number().int().nonnegative(),
  precision: Proportion.nullable(),
  recall: Proportion.nullable(),
  falsePositiveRate: Proportion.nullable(),
});
export type StrategyScore = z.infer<typeof StrategyScore>;

/** A set of test cases and the strategies scored over it. */
export const AnalysisScope = z.object({
  id: z.enum(['scan', 'claimed']),
  /** What the scope covers, and why it is the right set for the question it answers. */
  description: z.string().min(1),
  rules: z.number().int().nonnegative(),
  cases: z.number().int().nonnegative(),
  strategies: z.array(StrategyScore),
});
export type AnalysisScope = z.infer<typeof AnalysisScope>;

export const AnalysisReport = z.object({
  schemaVersion: z.literal(1),
  generated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  commit: z.string().nullable(),
  renderer: z.enum(['static', 'browser']),
  /** Interval method, stated once so every figure below can be recomputed. */
  interval: z.literal('wilson-95'),
  scopes: z.array(AnalysisScope),
  /**
   * How often the router changes its mind when one test case is held out: the cases on
   * which the engine chosen without that case differs from the published choice.
   */
  routingStability: z.object({
    cases: z.number().int().nonnegative(),
    casesWhereChoiceChanges: z.number().int().nonnegative(),
    rulesWhereChoiceChanges: z.array(ActRuleId),
  }),
  /** Pairwise agreement between engines on the official cases both of them answered. */
  agreement: z.array(
    z.object({
      engines: z.tuple([EngineId, EngineId]),
      cases: z.number().int().nonnegative(),
      percentAgreement: z.number().min(0).max(1).nullable(),
      kappa: z.number().min(-1).max(1).nullable(),
      /** The same, with outcomes reduced to failed or not failed. */
      kappaFailed: z.number().min(-1).max(1).nullable(),
    }),
  ),
  /**
   * The routing chosen on the official corpus, scored on the rated real pages:
   * the other held-out design, on a corpus the router never saw. Null until a cell is
   * resolved, because without ground truth there is nothing to score against.
   */
  realPages: z
    .object({
      resolvedCells: z.number().int().positive(),
      strategies: z.array(StrategyScore),
    })
    .nullable(),
  /** How many entries the protocol flatters at other recall thresholds than the published one. */
  flatterySensitivity: z.array(
    z.object({
      recallBelow: z.number().min(0).max(1),
      entries: z.number().int().nonnegative(),
      marloEntries: z.number().int().nonnegative(),
    }),
  ),
});
export type AnalysisReport = z.infer<typeof AnalysisReport>;
