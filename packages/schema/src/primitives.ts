import { z } from 'zod';
import { frozenRecord } from './freeze.js';

/**
 * The vocabulary everything else is built from.
 *
 * Two of these encode decisions rather than data shapes, and both come out of
 * the sibling PDF project's failures:
 *
 *   Outcome uses ACT's four values, including cantTell. A tool that cannot
 *   distinguish "this passes" from "I could not tell" will eventually report the
 *   second as the first.
 *
 *   RuleStatus separates a rule that ran from a rule that crashed or could not be
 *   evaluated. The sibling project's principle: a check that failed to run must
 *   never be indistinguishable from a check that found nothing.
 */

/**
 * An ACT rule identifier. Six characters, lower-case alphanumeric, assigned by
 * the ACT-Rules Community. Examples: `b5c3f8`, `c487ae`, `qt1vmo`.
 *
 * Validated by shape rather than against the corpus, because @marlo/schema is
 * pure and does not read files. @marlo/act checks membership.
 */
export const ActRuleId = z
  .string()
  .regex(/^[a-z0-9]{6}$/, 'an ACT rule id is six lower-case alphanumeric characters');
export type ActRuleId = z.infer<typeof ActRuleId>;

/**
 * A WCAG success criterion, as `chapter.guideline.criterion`. Examples: `1.1.1`,
 * `2.4.4`, `1.4.13`.
 */
export const SuccessCriterion = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'a success criterion looks like 1.1.1');
export type SuccessCriterion = z.infer<typeof SuccessCriterion>;

/** WCAG conformance level. */
export const ConformanceLevel = z.enum(['A', 'AA', 'AAA']);
export type ConformanceLevel = z.infer<typeof ConformanceLevel>;

/**
 * The four outcomes ACT Rules Format defines for evaluating a rule against a
 * subject.
 *
 * `cantTell` is the one that matters and the one most tools do not model.
 * Marlo's calibration table reports it as its own column, because low strict
 * recall caused by caution and low strict recall caused by incapacity look
 * identical if you fold cantTell into either passed or failed. See
 * DECISIONS.md D-004.
 */
export const Outcome = z.enum(['passed', 'failed', 'cantTell', 'inapplicable']);
export type Outcome = z.infer<typeof Outcome>;

/**
 * What an official ACT test case is expected to produce. Deliberately narrower
 * than `Outcome`: a test case is never expected to be `cantTell`, because that
 * would be a test case with no answer.
 */
export const ExpectedOutcome = z.enum(['passed', 'failed', 'inapplicable']);
export type ExpectedOutcome = z.infer<typeof ExpectedOutcome>;

/**
 * Whether the evaluation happened at all, which is a different question from
 * what it concluded.
 *
 *   ok           the rule ran and produced outcomes
 *   error        the rule threw. Never counted as a pass anywhere, including in
 *                the calibration table, where it is its own outcome so the
 *                denominator stays honest
 *   unsupported  the active renderer does not provide a capability the rule
 *                requires. Reported as unsupported, never as a pass. This is the
 *                difference between "no contrast problems were found" and
 *                "contrast was not examined". See DECISIONS.md D-005
 */
export const RuleStatus = z.enum(['ok', 'error', 'unsupported']);
export type RuleStatus = z.infer<typeof RuleStatus>;

/**
 * What a renderer provides, and therefore what a rule may rely on.
 *
 *   dom     a parsed document with attributes and computed accessible names
 *   script  scripts have executed
 *   layout  CSS has been applied, so computed styles and geometry are real
 *   paint   stacking and paint order are known, which contrast needs for
 *           backgrounds behind transparency
 */
export const Capability = z.enum(['dom', 'script', 'layout', 'paint']);
export type Capability = z.infer<typeof Capability>;

/**
 * The engines in the calibration table. `marlo` is one of them, with no
 * exemption: DECISIONS.md D-008.
 */
export const EngineId = z.enum(['marlo', 'axe-core', 'alfa', 'htmlcs']);
export type EngineId = z.infer<typeof EngineId>;

/** Which renderer produced the page a finding came from. */
export const RendererId = z.enum(['static', 'browser', 'remote']);
export type RendererId = z.infer<typeof RendererId>;

/**
 * Severity, with the presentation constraint built into the data.
 *
 * The brief requires that severity is never encoded by colour alone. Rather than
 * leaving that to whoever writes the next surface, every severity carries a
 * `mark`, which is a short text token, and a `label`. A renderer that prints the
 * mark satisfies the requirement without having to know about the requirement.
 *
 * The ordering is `rank`, ascending in seriousness, so sorting does not depend on
 * the order of an enum.
 */
export const Severity = z.enum(['advisory', 'moderate', 'serious', 'critical']);
export type Severity = z.infer<typeof Severity>;

export const SEVERITY_PRESENTATION: Readonly<
  Record<Severity, { readonly rank: number; readonly mark: string; readonly label: string }>
> = frozenRecord<
  Severity,
  { readonly rank: number; readonly mark: string; readonly label: string }
>({
  advisory: { rank: 1, mark: '···', label: 'advisory' },
  moderate: { rank: 2, mark: '▲', label: 'moderate' },
  serious: { rank: 3, mark: '▲▲', label: 'serious' },
  critical: { rank: 4, mark: '▲▲▲', label: 'critical' },
});

/**
 * A byte range in a source file, half-open: `start` is included, `end` is not.
 *
 * Byte offsets rather than line and column are the primary representation
 * because the repair layer edits byte ranges (DECISIONS.md D-006), and a fix
 * described in lines has to be re-derived before it can be applied. Line and
 * column come along for human output and are derived, never authoritative.
 */
export const SourceRange = z
  .object({
    file: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  })
  .refine((r) => r.end >= r.start, { message: 'end must not precede start' });
export type SourceRange = z.infer<typeof SourceRange>;

/**
 * Where a finding is in the rendered document, independent of source. A CSS
 * selector plus the ancestor path, so a finding can be reported even when it
 * cannot be located in source, which is the honest outcome for a construct that
 * came from a component prop.
 */
export const DomTarget = z.object({
  selector: z.string().min(1),
  /** Serialised outer HTML of the element, truncated. Evidence, not a document. */
  snippet: z.string(),
  /** Ancestor tag path, outermost first. Cheap orientation in a big page. */
  path: z.array(z.string()).default([]),
});
export type DomTarget = z.infer<typeof DomTarget>;

/**
 * A correlation id, threaded through every stage of a run so a finding can be
 * traced back to the render that produced it.
 */
export const RunId = z.string().regex(/^[0-9a-f]{16}$/, 'a run id is 16 hex characters');
export type RunId = z.infer<typeof RunId>;
