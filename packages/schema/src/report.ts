import { z } from 'zod';
import {
  ActRuleId,
  Capability,
  EngineId,
  RendererId,
  RunId,
  Severity,
  SuccessCriterion,
} from './primitives.js';
import { Finding, RuleResult } from './finding.js';
import { Flag, Repair, VerifiedFix } from './repair.js';

/**
 * What Marlo hands back, on every surface.
 *
 * The shape that matters is `Coverage`, which has no percentage field. A coverage
 * percentage without its denominator is the claim this project exists to argue
 * against, so the type does not offer one and a consumer that wants one has to
 * divide, at which point they are holding the denominator.
 */

/**
 * Coverage, as a fraction with everything visible.
 *
 * `unmeasurable` is the honest field. Three published ACT rules have no official
 * test cases, so a rule Marlo implements might be uncalibratable through nobody's
 * fault. Leaving those out of the count would overstate coverage; counting them as
 * calibrated would overstate accuracy. They are named.
 */
export const Coverage = z.object({
  implemented: z.number().int().nonnegative(),
  publishedActRules: z.number().int().positive(),
  calibrated: z.number().int().nonnegative(),
  unmeasurable: z.array(ActRuleId).default([]),
  /**
   * Rules that were requested but reported `unsupported` because the active
   * renderer lacks a capability. Not a miss and not a pass.
   */
  notEvaluated: z.array(
    z.object({
      actRuleId: ActRuleId,
      missing: z.array(Capability),
    }),
  ),
});
export type Coverage = z.infer<typeof Coverage>;

/**
 * Renders coverage the only way Marlo is allowed to state it.
 *
 * A single function so that the CLI, the pull request body, the SARIF properties
 * and the website cannot phrase it four different ways, and so that there is
 * exactly one place a reviewer has to look to confirm no percentage escapes.
 */
export function formatCoverage(coverage: Coverage): string {
  return `${String(coverage.implemented)} of ${String(coverage.publishedActRules)} published ACT rules`;
}

/**
 * The counts a reader wants first, and the exit code depends on.
 *
 * `errored` and `notEvaluated` are separate from everything else. Folding a rule
 * that crashed into "no findings" is the sibling project's defect, one layer up.
 */
export const ScanTotals = z.object({
  findings: z.number().int().nonnegative(),
  bySeverity: z.record(Severity, z.number().int().nonnegative()),
  fixed: z.number().int().nonnegative(),
  flagged: z.number().int().nonnegative(),
  /** Rules that threw. Never counted as clean. */
  errored: z.number().int().nonnegative(),
  /** Rules the renderer could not evaluate. Never counted as clean. */
  notEvaluated: z.number().int().nonnegative(),
  /**
   * How many findings were withheld from human-readable output, and why. A report
   * listing twelve contrast failures on a page with three hundred implies the page
   * has twelve. Borrowed from the sibling project.
   */
  withheld: z.object({
    count: z.number().int().nonnegative(),
    reason: z.string().nullable(),
  }),
});
export type ScanTotals = z.infer<typeof ScanTotals>;

/** One page that was scanned. */
export const PageResult = z.object({
  /** The URL or file path the caller gave, verbatim. */
  target: z.string().min(1),
  renderer: RendererId,
  capabilities: z.array(Capability),
  findings: z.array(Finding),
  /** Every rule result from every engine, including passes. Evidence. */
  results: z.array(RuleResult),
  durationMs: z.number().nonnegative(),
});
export type PageResult = z.infer<typeof PageResult>;

/**
 * A complete run. This is what `marlo scan --json` prints and what the MCP server
 * returns.
 */
export const ScanReport = z.object({
  schemaVersion: z.literal(1),
  runId: RunId,
  marloVersion: z.string().min(1),
  /** ISO 8601. The one place a timestamp is allowed: this is a log, not an artifact. */
  startedAt: z.iso.datetime(),

  /** Which calibration table the confidence numbers came from. */
  calibration: z.object({
    generated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    commit: z.string().nullable(),
    corpusRetrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),

  engines: z.array(z.object({ id: EngineId, version: z.string().min(1) })),
  pages: z.array(PageResult),
  repairs: z.array(Repair).default([]),
  coverage: Coverage,
  totals: ScanTotals,

  /**
   * Set when the one-directional invariant forced Marlo to report a rule as
   * failing against its own chosen engine's verdict. Empty is the common case;
   * non-empty is worth a reader's attention and appears in the terminal output.
   */
  invariantEnforced: z
    .array(
      z.object({
        actRuleId: ActRuleId,
        dissentingEngine: EngineId,
        chosenEngine: EngineId,
      }),
    )
    .default([]),
});
export type ScanReport = z.infer<typeof ScanReport>;

/**
 * The generated pull request body, as data rather than a string.
 *
 * Kept structured up to the last moment for two reasons. The template can then be
 * asserted section by section in tests, which a rendered string cannot be without
 * matching prose. And the forbidden-claims check runs over the rendered output, so
 * having one renderer rather than string concatenation scattered around means
 * there is one place a claim could be introduced.
 */
export const PullRequestBody = z.object({
  /** Imperative, scoped, no trailing full stop. */
  title: z.string().min(1),

  /** Rendered first. What was wrong, in the reader's terms. */
  summary: z.string().min(1),

  fixes: z.array(VerifiedFix),
  flags: z.array(Flag),

  coverage: Coverage,

  /** Every engine that ran, with versions, so the claim is reproducible. */
  engines: z.array(z.object({ id: EngineId, version: z.string().min(1) })),
  renderer: RendererId,

  /** The calibration table this rests on. */
  calibration: z.object({
    generated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    commit: z.string().nullable(),
    url: z.url(),
  }),

  /**
   * How to reject the whole thing, and how to reject one fix. Required, because a
   * pull request that does not say how to say no is not opt-in in practice.
   */
  howToReject: z.object({
    all: z.string().min(1),
    single: z.string().min(1),
    permanently: z.string().min(1),
  }),

  /** Success criteria touched, for a reader auditing against a specific one. */
  successCriteria: z.array(SuccessCriterion),
});
export type PullRequestBody = z.infer<typeof PullRequestBody>;

/**
 * Exit codes. Enumerated here so the CLI, the Action and the documentation cannot
 * disagree about what 2 means.
 */
export const EXIT_CODES = Object.freeze({
  /** No findings at or above the configured threshold. */
  clean: 0,
  /** Findings at or above the threshold. The ordinary "there is work" code. */
  findings: 1,
  /** Marlo could not run: bad arguments, unreadable target, missing renderer. */
  usage: 2,
  /**
   * A rule crashed, or a rule could not be evaluated and the caller asked for it
   * to be treated as a failure. Distinct from `findings` so a script can tell
   * "your page has problems" from "my measurement is incomplete".
   */
  incomplete: 3,
});
export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
