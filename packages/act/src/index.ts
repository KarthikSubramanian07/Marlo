/**
 * @marlo/act
 *
 * The ACT rule corpus as data, the official W3C grading protocol, and the accuracy
 * and coverage arithmetic every published number is computed with.
 *
 * Pure: no filesystem, no network, asserted by dependency-cruiser. The rule index
 * is generated into `rules.generated.ts` from the vendored corpus manifest rather
 * than read at import time, and a test reads the manifest and asserts the two
 * agree, so they cannot drift.
 *
 * Held at 100 percent coverage in CI. Every accuracy claim Marlo makes is
 * arithmetic performed here, and a partly covered grading protocol means an
 * unmeasured accuracy claim, which is the failure this project exists to argue
 * against.
 */

export type { ActRuleRecord } from './rules.generated.js';
export { ACT_RULES, CORPUS_RETRIEVED } from './rules.generated.js';
export {
  MEASURABLE_ACT_RULES,
  PUBLISHED_ACT_RULE_COUNT,
  UNMEASURABLE_ACT_RULES,
  allCoveredCriteria,
  compareCriteria,
  findRule,
  isPublishedRule,
  rulesForCriterion,
} from './rules.js';
export type { GradedCase } from './protocol.js';
export {
  automationOf,
  consistencyOf,
  disallowedCount,
  isAllowed,
  isFlatteredByProtocol,
  outcomeMatrixOf,
} from './protocol.js';
export {
  aggregateStrictAccuracy,
  harmonicMean,
  meetsAutoFixThreshold,
  ratio,
  strictAccuracyOf,
} from './accuracy.js';
export type { CoverageInput } from './coverage.js';
export { UnknownRuleError, computeCoverage, describeGap } from './coverage.js';
