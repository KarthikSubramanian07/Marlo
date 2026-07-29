/**
 * @marlo/schema
 *
 * Every artifact Marlo produces, and its runtime validator. This package is the
 * vocabulary: it depends on nothing else in the repository, because a vocabulary
 * that depended on a speaker would not be one. Asserted by dependency-cruiser.
 *
 * Two types here carry design decisions rather than data shapes, and they are the
 * reason to read this package before the pipeline:
 *
 *   `Repair` is a discriminated union of `VerifiedFix` and `Flag`. There is no
 *   state meaning "claimed", and `VerifiedFix.verification` is required and
 *   non-nullable. It is not possible to construct a value that says a fix worked
 *   without attaching the measurement that showed it. See repair.ts.
 *
 *   `RuleResult.status` distinguishes a rule that ran from one that crashed and one
 *   the renderer could not evaluate. A check that failed to run must never be
 *   indistinguishable from a check that found nothing, which is the sibling PDF
 *   project's principle and the reason its worst defect was eventually caught.
 *
 * And one function: `formatCoverage` is the only sanctioned way to state coverage,
 * so a percentage without its denominator cannot escape onto a surface.
 */

export * from './freeze.js';
export * from './primitives.js';
export * from './finding.js';
export * from './repair.js';
export * from './calibration.js';
export * from './report.js';
export * from './config.js';
