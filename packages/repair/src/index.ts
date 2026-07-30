/**
 * @marlo/repair
 *
 * Source location, minimal diffs, and the verification that makes a fix a fix.
 *
 * The shape to know: `Repair = VerifiedFix | Flag`, from `@marlo/schema`, with no `attempted`
 * case and no verification-optional variant. An unverified fix has no representation, so this
 * package cannot produce one however it is called. What it can do is fail to earn the
 * `VerifiedFix` side, and then it says which of the three verification questions went wrong.
 *
 * Seven rules have a mechanical codemod. On the current calibration table only two of them clear
 * the measured auto-fix threshold, so the other five come back as flags carrying the number that
 * disqualified them, with the generated change attached but not applied. That is the gate
 * working rather than a shortfall: a codemod for a rule whose detection is right 29% of the time
 * would apply four wrong edits for every right one.
 */
export type { ElementDescription, LocatedElement } from './locate.js';
export { attributeOccurrences, indexElements, locate, matchesOf } from './locate.js';
export { EditConflictError, applyEdits, conflicts, isIdempotent } from './apply.js';
export type { CodemodInput, CodemodResult } from './codemod.js';
export { CODEMODS, runCodemod, rulesWithCodemods } from './codemod.js';
export type { RepairContext, ThresholdCheck } from './verify.js';
export { checkThreshold, repairFinding, repairedText } from './verify.js';
