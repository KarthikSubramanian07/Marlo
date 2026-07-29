import { z } from 'zod';
import { ActRuleId, EngineId, Outcome, SourceRange, SuccessCriterion } from './primitives.js';
import { Disagreement, Finding } from './finding.js';

/**
 * Repairs, and the reason this file is shaped the way it is.
 *
 * There is no state meaning "claimed". A `Repair` is either `fixed`, in which
 * case a `Verification` is attached and the type system required it, or
 * `flagged`, in which case evidence is attached and the type system required
 * that. There is no third case and no optional verification field, because an
 * optional verification field is a claimed fix with extra steps.
 *
 * The LLM accessibility literature's two dominant failure modes are a fix
 * asserted rather than verified, and a fix that drifts into redesign. The first
 * is prevented here. The second is prevented by `Edit` being a byte range rather
 * than a file: there is no function anywhere in Marlo that takes source and
 * returns different source. See DECISIONS.md D-006.
 */

/**
 * What kind of change an edit makes. The allow-list, enforced before any edit is
 * applied.
 *
 * The point is that this list is short and closed. A repair that would need an
 * operation not on it is a flag, not a new list entry, unless someone argues the
 * case in a pull request.
 */
export const EditKind = z.enum([
  /** Add an attribute that was absent. `<html>` gains `lang="en"`. */
  'add-attribute',
  /** Change an attribute's value in place. `aria-checked="yes"` becomes `"true"`. */
  'set-attribute-value',
  /** Remove an attribute entirely. An `aria-` property that is not permitted. */
  'remove-attribute',
  /** Rename an attribute, keeping its value. Misspelled ARIA properties. */
  'rename-attribute',
  /**
   * Insert a complete element. Used for skip links and landmark wrappers. The
   * most dangerous entry on this list, which is why it carries its own
   * `insertedElement` field so review can see exactly what appears.
   */
  'insert-element',
  /** Change an element's tag name, keeping attributes and children. Heading levels. */
  'rename-element',
  /**
   * Remove one declaration from a `style` attribute. Used by the text spacing
   * rules, which fail on an `!important` that prevents user override.
   */
  'remove-style-declaration',
]);
export type EditKind = z.infer<typeof EditKind>;

/**
 * One byte-range replacement in one file.
 *
 * Half-open range, matching `SourceRange`. `before` is the exact bytes being
 * replaced, carried so that application can refuse if the file changed underneath
 * it rather than corrupting it.
 */
export const Edit = z
  .object({
    file: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    /** The bytes currently there. Application verifies this before replacing. */
    before: z.string(),
    /** What replaces them. Empty string for a removal. */
    after: z.string(),
    kind: EditKind,
    /** The ACT rule this edit serves. An edit with no rule is not a repair. */
    actRuleId: ActRuleId,
    /** For `insert-element`, the element being introduced, for review. */
    insertedElement: z.string().nullable().default(null),
    /** One line, imperative, for the pull request body. */
    rationale: z.string().min(1),
  })
  .refine((e) => e.end >= e.start, { message: 'end must not precede start' })
  .refine((e) => e.before.length === e.end - e.start, {
    message: 'before must be exactly the bytes the range covers',
  })
  .refine((e) => e.kind !== 'insert-element' || e.insertedElement !== null, {
    message: 'insert-element must record the element it inserts',
  });
export type Edit = z.infer<typeof Edit>;

/**
 * What re-running the engines on the repaired page showed.
 *
 * Three separate questions, because passing the first two and failing the third
 * is a fix that broke something else, and that has to be a flag rather than a
 * success with a footnote.
 */
export const Verification = z.object({
  /** The rule the repair targeted no longer fails, on every engine that implements it. */
  targetClosed: z.boolean(),
  /** No ACT rule that passed before the edit fails after it. */
  noNewViolations: z.boolean(),
  /** Applying the edits twice produces the same document as applying them once. */
  idempotent: z.boolean(),

  /** Which engines were re-run. An empty list is not a verification. */
  enginesRun: z.array(EngineId).min(1),
  /** Per engine, the outcome for the targeted rule after the repair. */
  outcomesAfter: z.array(
    z.object({
      engine: EngineId,
      actRuleId: ActRuleId,
      outcome: Outcome,
    }),
  ),
  /** Any rule that regressed. Non-empty means `noNewViolations` is false. */
  regressions: z.array(
    z.object({
      actRuleId: ActRuleId,
      engine: EngineId,
      before: Outcome,
      after: Outcome,
    }),
  ),
  durationMs: z.number().nonnegative(),
});
export type Verification = z.infer<typeof Verification>;

/** Why Marlo declined to repair something it detected. */
export const FlagReason = z.enum([
  /**
   * The correct fix is a design decision. Contrast is the canonical case:
   * recolouring is somebody's choice, not a mechanical correction.
   */
  'design-decision',
  /** The page does not supply the meaning, so any description would be invented. */
  'meaning-not-in-page',
  /** The construct is in source Marlo could not locate exactly. */
  'source-not-located',
  /** Calibration data for this rule is below the documented auto-fix threshold. */
  'below-threshold',
  /** No engine has measured accuracy for this rule, so there is no threshold to clear. */
  'uncalibrated',
  /** The fix needs a component refactor, for instance focus management. */
  'needs-refactor',
  /** A repair was generated and verification did not confirm it. */
  'verification-failed',
  /** The active renderer could not evaluate the rule, so a fix cannot be verified. */
  'renderer-cannot-verify',
]);
export type FlagReason = z.infer<typeof FlagReason>;

/**
 * A detected problem Marlo did not fix, with everything a human needs to decide.
 *
 * Every field here is required. A flag without evidence is a to-do item, and a
 * to-do item in a pull request body is noise the reader learns to skip.
 */
export const Flag = z.object({
  kind: z.literal('flagged'),
  finding: Finding,
  reason: FlagReason,
  /** Plain language, addressed to whoever has to act. Not a rule restatement. */
  explanation: z.string().min(1),
  /** The specific decision being handed over. */
  humanDecision: z.string().min(1),
  /** Which engines agreed the problem exists. Empty is not permitted here. */
  corroboratedBy: z.array(EngineId).min(1),
  disagreements: z.array(Disagreement).default([]),
  /**
   * The measured values that made this a flag rather than a fix, when the reason
   * is a threshold. Null when the reason is categorical, like a design decision.
   */
  thresholdEvidence: z
    .object({
      strictPrecision: z.number().min(0).max(1).nullable(),
      strictRecall: z.number().min(0).max(1).nullable(),
      threshold: z.number().min(0).max(1),
      sampleSize: z.number().int().nonnegative(),
    })
    .nullable()
    .default(null),
  /**
   * A repair Marlo generated but could not verify, kept so the reader can judge
   * it. Present only when reason is `verification-failed`. Never applied.
   */
  unverifiedEdits: z.array(Edit).default([]),
  failedVerification: Verification.nullable().default(null),
});
export type Flag = z.infer<typeof Flag>;

/**
 * A repair that was applied and verified.
 *
 * `verification` is required and non-nullable. That is the single most important
 * line in this package.
 */
export const VerifiedFix = z.object({
  kind: z.literal('fixed'),
  finding: Finding,
  actRuleId: ActRuleId,
  successCriteria: z.array(SuccessCriterion),
  edits: z.array(Edit).min(1),
  verification: Verification,
  /** Where the change landed, for the pull request body. */
  ranges: z.array(SourceRange).min(1),
  /** One sentence for a reviewer who will not read the diff. */
  summary: z.string().min(1),
  /** How to reject this specific change without rejecting the rest. */
  howToReject: z.string().min(1),
});
export type VerifiedFix = z.infer<typeof VerifiedFix>;

/**
 * The only two things Marlo can produce for a detected problem.
 *
 * Discriminated on `kind`, so exhaustiveness checking catches a third case being
 * added without every consumer being updated. There is deliberately no
 * `'attempted'`, no `'probably-fixed'`, and no verification-optional variant.
 */
export const Repair = z.discriminatedUnion('kind', [VerifiedFix, Flag]);
export type Repair = z.infer<typeof Repair>;

/**
 * Narrowing helper, so consumers do not compare string literals by hand.
 */
export function isVerifiedFix(repair: Repair): repair is VerifiedFix {
  return repair.kind === 'fixed';
}

/**
 * True when a `Verification` actually clears all three bars.
 *
 * Exists so that no consumer has to remember there are three. A fix whose target
 * closed but which broke something else is not verified, and a caller checking
 * only `targetClosed` would report it as fixed.
 */
export function isFullyVerified(verification: Verification): boolean {
  return verification.targetClosed && verification.noNewViolations && verification.idempotent;
}
