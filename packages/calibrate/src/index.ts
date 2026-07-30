/**
 * @marlo/calibrate
 *
 * Measures every engine against the official ACT test cases and produces the calibration
 * table, which is the artifact every downstream claim rests on.
 *
 * The design constraint that makes the table worth anything: every engine goes through
 * the same code path. No engine gets a longer timeout, a retry, a different renderer, or
 * a special case, and Marlo's own engine is one of the four with no exemption. That is
 * DECISIONS.md D-008, and `MarloEngine` here is a deliberately logic-free wrapper for
 * exactly that reason.
 */

export type { Corpus, CorpusCase } from './corpus.js';
export { loadCorpus } from './corpus.js';
export { MarloEngine } from './marlo-engine.js';
export type { HarnessOptions } from './harness.js';
export { outcomeSpread, routeRule, runHarness } from './harness.js';
export type { Regression } from './publish.js';
export { findRegressions, renderCalibrationMarkdown } from './publish.js';
