import type {
  ActRuleId,
  CalibrationTable,
  Edit,
  EngineReport,
  Finding,
  Flag,
  Outcome,
  Repair,
  RuleResult,
  Verification,
  VerifiedFix,
} from '@marlo/schema';
import type { Renderer } from '@marlo/render';
import { applyEdits, isIdempotent } from './apply.js';
import { runCodemod } from './codemod.js';

/**
 * The verification loop.
 *
 * `Repair = VerifiedFix | Flag` has been in the schema since the first package, with no
 * `attempted` case and no verification-optional variant, so an unverified fix has never had a
 * representation to construct. This is the code that has to earn the `VerifiedFix` side of it.
 *
 * THREE QUESTIONS, ANSWERED SEPARATELY
 *
 * `Verification` asks whether the target rule closed, whether anything else broke, and whether
 * applying the edits twice is the same as applying them once. They are separate fields because
 * passing two and failing the third is a fix that broke something else, and that has to become a
 * flag rather than a success with a footnote.
 *
 * The second question is the one that matters most and is easiest to skip. A codemod that closes
 * its target and opens a different violation has made the page worse while reporting a win.
 *
 * WHAT THE RENDERER CANNOT VERIFY, IT DOES NOT VERIFY
 *
 * Re-running the engines means re-rendering, and on a renderer with no layout the
 * layout-dependent rules come back `unsupported` before the edit and `unsupported` after it.
 * That is not evidence that anything closed. `FlagReason` has `renderer-cannot-verify` for
 * exactly this, and a fix for such a rule is flagged even when the edit is obviously right.
 */

export interface RepairContext {
  readonly html: string;
  readonly file: string;
  readonly renderer: Renderer;
  readonly table: CalibrationTable;
  /** Runs every engine over a rendered page. Injected so this file has no engine import. */
  readonly evaluate: (
    html: string,
    rules: readonly ActRuleId[],
  ) => Promise<readonly EngineReport[]>;
}

/** Collapses one engine's result for a rule to the outcome the protocol grades. */
function collapse(result: RuleResult | undefined): Outcome | 'unsupported' | 'error' | null {
  if (result === undefined) return null;
  if (result.status === 'unsupported') return 'unsupported';
  if (result.status === 'error') return 'error';
  if (result.verdicts.length === 0) return 'inapplicable';
  if (result.verdicts.some((v) => v.outcome === 'failed')) return 'failed';
  if (result.verdicts.some((v) => v.outcome === 'cantTell')) return 'cantTell';
  if (result.verdicts.some((v) => v.outcome === 'passed')) return 'passed';
  return 'inapplicable';
}

function outcomesFor(
  reports: readonly EngineReport[],
  actRuleId: ActRuleId,
): ReadonlyMap<string, Outcome | 'unsupported' | 'error' | null> {
  const out = new Map<string, Outcome | 'unsupported' | 'error' | null>();
  for (const report of reports) {
    out.set(report.engine, collapse(report.results.find((r) => r.actRuleId === actRuleId)));
  }
  return out;
}

/** Every rule any engine reported as failing, so a regression can be spotted. */
function failingRules(reports: readonly EngineReport[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const report of reports) {
    for (const result of report.results) {
      if (collapse(result) === 'failed') out.add(result.actRuleId);
    }
  }
  return out;
}

/**
 * Whether the measured accuracy of the engine reporting this rule clears the published gate.
 *
 * The gate is on precision rather than recall, deliberately. A missed violation is a gap you
 * already had. A wrong fix is a change to your code that you did not ask for.
 */
export interface ThresholdCheck {
  readonly permitted: boolean;
  readonly strictPrecision: number | null;
  readonly strictRecall: number | null;
  readonly threshold: number;
  readonly sampleSize: number;
}

export function checkThreshold(
  table: CalibrationTable,
  actRuleId: ActRuleId,
  engine: string,
): ThresholdCheck {
  const entry = table.entries.find((e) => e.actRuleId === actRuleId && e.engine === engine);
  const threshold = table.autoFixThreshold.minStrictPrecision;
  const minimumSample = table.autoFixThreshold.minSampleSize;
  const precision = entry?.strict.precision ?? null;
  const sampleSize = entry?.testCaseCount ?? 0;
  return {
    permitted: precision !== null && precision >= threshold && sampleSize >= minimumSample,
    strictPrecision: precision,
    strictRecall: entry?.strict.recall ?? null,
    threshold,
    sampleSize,
  };
}

function flag(
  finding: Finding,
  reason: Flag['reason'],
  explanation: string,
  humanDecision: string,
  extras: Partial<Flag> = {},
): Flag {
  return {
    kind: 'flagged',
    finding,
    reason,
    explanation,
    humanDecision,
    corroboratedBy: finding.agreedBy.length > 0 ? [...finding.agreedBy] : [finding.reportedBy],
    disagreements: [...finding.disagreements],
    thresholdEvidence: null,
    unverifiedEdits: [],
    failedVerification: null,
    ...extras,
  };
}

/**
 * Turns one finding into a repair.
 *
 * Reads as a sequence of refusals, and that ordering is the design. Every reason to decline is
 * checked before anything is applied, so the expensive path is only taken for a finding that has
 * already earned it.
 */
export async function repairFinding(finding: Finding, context: RepairContext): Promise<Repair> {
  const { actRuleId } = finding;

  // 1. Is there a mechanical fix at all?
  const codemod = runCodemod({ html: context.html, file: context.file, actRuleId });
  if (codemod.edits.length === 0) {
    const reason: Flag['reason'] =
      codemod.declined?.includes('located') === true ? 'source-not-located' : 'needs-refactor';
    return flag(
      finding,
      reason,
      codemod.declined ?? 'no mechanical fix exists for this rule.',
      'Decide what the correct markup is. Marlo located the problem and stopped there.',
    );
  }

  // 2. Does the engine that reported it measure well enough to be trusted with an edit?
  const threshold = checkThreshold(context.table, actRuleId, finding.reportedBy);
  if (!threshold.permitted) {
    return flag(
      finding,
      threshold.strictPrecision === null ? 'uncalibrated' : 'below-threshold',
      threshold.strictPrecision === null
        ? `No engine has measured accuracy for ${actRuleId}, so there is no threshold for it to ` +
            'clear. Marlo generated a fix and will not apply one it cannot justify.'
        : `${finding.reportedBy} reports ${actRuleId} with strict precision ` +
            `${threshold.strictPrecision.toFixed(2)} over ${String(threshold.sampleSize)} official ` +
            `test cases, against a threshold of ${threshold.threshold.toFixed(2)}. The fix below is ` +
            'mechanical and is still not applied, because the detection it rests on is not ' +
            'accurate enough.',
      'Read the generated change and apply it if you agree. Reporting a false positive on this ' +
        'rule is the fastest way to move the number.',
      {
        thresholdEvidence: {
          strictPrecision: threshold.strictPrecision,
          strictRecall: threshold.strictRecall,
          threshold: threshold.threshold,
          sampleSize: threshold.sampleSize,
        },
        unverifiedEdits: [...codemod.edits],
      },
    );
  }

  // 3. Can this renderer even tell whether the fix worked?
  const started = Date.now();
  const before = await context.evaluate(context.html, [actRuleId]);
  const beforeOutcomes = outcomesFor(before, actRuleId);
  if ([...beforeOutcomes.values()].every((o) => o === 'unsupported' || o === null)) {
    return flag(
      finding,
      'renderer-cannot-verify',
      `Every engine reported ${actRuleId} as unsupported on the ${context.renderer.id} renderer, ` +
        'so re-running them after an edit would prove nothing. An unverifiable fix is a flag ' +
        'even when the edit is obviously correct.',
      'Run again with a renderer that provides the capability this rule needs, or apply the ' +
        'change below yourself.',
      { unverifiedEdits: [...codemod.edits] },
    );
  }

  // 4. Apply, and ask the three questions.
  let repaired: string;
  try {
    repaired = applyEdits(context.html, codemod.edits);
  } catch (error) {
    return flag(
      finding,
      'verification-failed',
      `The edits could not be applied: ${error instanceof Error ? error.message : String(error)}`,
      'Look at the generated change and decide whether it is right.',
      { unverifiedEdits: [...codemod.edits] },
    );
  }

  const beforeFailing = failingRules(before);
  const after = await context.evaluate(repaired, [actRuleId]);
  const afterOutcomes = outcomesFor(after, actRuleId);

  // The target closed only if no engine that could see it still reports a failure.
  const targetClosed = ![...afterOutcomes.values()].includes('failed');

  // A full re-run, to answer the second question honestly. Cheaper answers exist and all of
  // them amount to assuming the edit was local, which is the assumption being tested.
  const fullAfter = await context.evaluate(repaired, []);
  const afterFailing = failingRules(fullAfter);
  const regressed = [...afterFailing].filter((rule) => !beforeFailing.has(rule));

  const idempotent = isIdempotent(
    context.html,
    codemod.edits,
    (text) => runCodemod({ html: text, file: context.file, actRuleId }).edits,
  );

  const verification: Verification = {
    targetClosed,
    noNewViolations: regressed.length === 0,
    idempotent,
    enginesRun: [...afterOutcomes.keys()].filter((e): e is Verification['enginesRun'][number] =>
      before.some((r) => r.engine === e),
    ),
    outcomesAfter: [...afterOutcomes.entries()]
      .filter(([, outcome]) => outcome !== null && outcome !== 'unsupported' && outcome !== 'error')
      .map(([engine, outcome]) => ({
        engine: engine as VerifiedFix['verification']['outcomesAfter'][number]['engine'],
        actRuleId,
        outcome: outcome as Outcome,
      })),
    regressions: regressed.map((rule) => ({
      actRuleId: rule,
      engine: finding.reportedBy,
      before: 'passed' as const,
      after: 'failed' as const,
    })),
    durationMs: Date.now() - started,
  };

  if (!verification.targetClosed || !verification.noNewViolations || !verification.idempotent) {
    const why = [
      verification.targetClosed ? null : 'the rule it targeted still fails',
      verification.noNewViolations
        ? null
        : `it broke ${regressed.join(', ')}, which passed before the edit`,
      verification.idempotent ? null : 'applying it twice is not the same as applying it once',
    ].filter((s): s is string => s !== null);
    return flag(
      finding,
      'verification-failed',
      `Marlo generated a fix and verification did not confirm it: ${why.join(', and ')}. It has ` +
        'not been applied.',
      'Read the change below. It is included so you can judge it, not because Marlo thinks it ' +
        'is right.',
      { unverifiedEdits: [...codemod.edits], failedVerification: verification },
    );
  }

  const ranges = codemod.edits.map((edit) => ({
    file: edit.file,
    start: edit.start,
    end: edit.start + edit.after.length,
    line: 1,
    column: 1,
  }));

  const fix: VerifiedFix = {
    kind: 'fixed',
    finding,
    actRuleId,
    successCriteria: [...finding.successCriteria],
    edits: [...codemod.edits] as [Edit, ...Edit[]],
    verification,
    ranges: ranges,
    summary: codemod.edits[0]?.rationale ?? 'A mechanical change, verified.',
    howToReject:
      `Revert this change, or add ${actRuleId} to marlo.config.json under never to stop Marlo ` +
      'offering it again.',
  };
  return fix;
}

/** The repaired text, for a caller that wants to write it. Null when nothing was fixed. */
export function repairedText(html: string, repairs: readonly Repair[]): string | null {
  const edits = repairs.flatMap((r) => (r.kind === 'fixed' ? r.edits : []));
  return edits.length === 0 ? null : applyEdits(html, edits);
}
