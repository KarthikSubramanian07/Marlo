import { randomBytes } from 'node:crypto';
import type {
  ActRuleId,
  Coverage,
  EngineReport,
  Finding,
  PageResult,
  ScanReport,
  Severity,
} from '@marlo/schema';
import { EXIT_CODES, type CalibrationTable } from '@marlo/schema';
import { computeCoverage, findRule } from '@marlo/act';
import type { Renderer } from '@marlo/render';
import { peerEngines } from '@marlo/engines';
import { IMPLEMENTED_RULES } from '@marlo/rules';
import { MarloEngine } from '@marlo/calibrate';
import { decideRule } from '@marlo/report';

/**
 * The scan pipeline: render, run every engine, route, apply the invariant, report.
 *
 * Repair is not wired in. The `fix` verb is the next branch, and the CLI's help text says
 * so rather than offering a flag that silently does nothing.
 */

/**
 * Severity per ACT rule.
 *
 * A judgment, and kept in one place so it can be argued with rather than being scattered
 * across thirty-five rule files. The reasoning behind the tiers, since a severity nobody
 * can question is a severity nobody trusts:
 *
 * `critical` is reserved for defects that stop somebody completing a task: an unnamed
 * control, a form field with no label, a viewport that forbids zoom.
 *
 * `serious` is a defect that degrades every interaction on the page without stopping it,
 * such as a missing document language, or one that actively misinforms, such as an invalid
 * ARIA value. Misinformation is ranked above absence deliberately: a screen reader user
 * can work around silence and cannot detect a lie.
 *
 * `moderate` is a real violation with a workaround. `advisory` is a finding Marlo cannot
 * be confident about, which is why the two rules that always return `cantTell` live there.
 */
const SEVERITY_BY_RULE: Readonly<Record<string, Severity>> = Object.freeze({
  c487ae: 'critical',
  '97a4e1': 'critical',
  e086e5: 'critical',
  '59796f': 'critical',
  b4f0c3: 'critical',

  '23a2a8': 'serious',
  ffd0e9: 'serious',
  cae760: 'serious',
  '8fc3b6': 'serious',
  '7d6734': 'serious',
  b5c3f8: 'serious',
  '6a7281': 'serious',
  '674b10': 'serious',
  '4e8ab6': 'serious',
  '6cfa84': 'serious',
  bc659a: 'serious',
  bisz58: 'serious',
  '2779a5': 'serious',
  afw4f7: 'serious',

  bf051a: 'moderate',
  de46e4: 'moderate',
  '5b7ae0': 'moderate',
  '5f99a7': 'moderate',
  '5c01ea': 'moderate',
  ff89c9: 'moderate',
  bc4a75: 'moderate',
  '3ea0c8': 'moderate',
  e6952f: 'moderate',
  '09o5cg': 'moderate',
  '78fd32': 'moderate',
  '24afc2': 'moderate',
  '9e45ec': 'moderate',
  '46ca7f': 'moderate',

  e88epe: 'advisory',
  '9eb3f6': 'advisory',
});

function severityOf(actRuleId: string): Severity {
  return SEVERITY_BY_RULE[actRuleId] ?? 'moderate';
}

export interface ScanTarget {
  readonly label: string;
  readonly html?: string;
  readonly path?: string;
}

export interface ScanOptions {
  readonly targets: readonly ScanTarget[];
  readonly renderer: Renderer;
  readonly table: CalibrationTable;
  readonly marloVersion: string;
  /** Rules to evaluate. Defaults to everything Marlo implements. */
  readonly rules?: readonly ActRuleId[];
}

/** A run id: hex, greppable in a log, short enough to read aloud. */
export function newRunId(): string {
  return randomBytes(8).toString('hex');
}

export async function scan(options: ScanOptions): Promise<ScanReport> {
  const rules = [...(options.rules ?? IMPLEMENTED_RULES)].sort();
  const engines = [new MarloEngine(), ...peerEngines()];
  const pages: PageResult[] = [];
  const invariantEnforced: ScanReport['invariantEnforced'] = [];

  for (const target of options.targets) {
    const started = Date.now();
    const page = await options.renderer.render(
      target.html === undefined ? { path: target.path ?? '' } : { html: target.html },
    );

    try {
      const reports: EngineReport[] = [];
      for (const engine of engines) reports.push(await engine.evaluate(page, rules));

      const findings: Finding[] = [];
      for (const actRuleId of rules) {
        const verdict = decideRule(actRuleId, reports, options.table);

        if (verdict.invariantEnforced) {
          invariantEnforced.push({
            actRuleId,
            dissentingEngine: verdict.reportedBy,
            chosenEngine:
              options.table.routing.find((r) => r.actRuleId === actRuleId)?.chosen ?? 'marlo',
          });
        }

        if (verdict.outcome !== 'failed') continue;

        const published = findRule(actRuleId);
        const entry = options.table.entries.find(
          (e) => e.actRuleId === actRuleId && e.engine === verdict.reportedBy,
        );
        const routed = options.table.routing.find((r) => r.actRuleId === actRuleId);

        // One finding per failing element, so a fix has somewhere to land.
        const source = verdict.evidence.find((r) => r.engine === verdict.reportedBy);
        const failing = (source?.verdicts ?? []).filter((v) => v.outcome === 'failed');

        for (const [index, engineVerdict] of failing.entries()) {
          findings.push({
            id: `${actRuleId}-${String(index)}`,
            actRuleId,
            actRuleName: published?.name ?? actRuleId,
            successCriteria: [...(published?.successCriteria ?? [])],
            severity: severityOf(actRuleId),
            reportedBy: verdict.reportedBy,
            routingReason: verdict.routingReason,
            verdict: engineVerdict,
            agreedBy: [...verdict.agreedBy],
            disagreements: [...verdict.disagreements],
            confidence: {
              source:
                entry === undefined || entry.testCaseCount === 0 ? 'uncalibrated' : 'calibrated',
              precision: entry?.strict.precision ?? null,
              recall: entry?.strict.recall ?? null,
              sampleSize: entry?.testCaseCount ?? 0,
              meetsAutoFixThreshold: routed?.autoFixPermitted ?? false,
            },
            // Source location arrives with the repair layer. Null with a stated reason is
            // the honest placeholder; a fabricated byte offset would not be.
            source: null,
            locationNote:
              'Source location arrives with the repair layer. The selector above is where ' +
              'the problem is in the rendered page.',
            renderer: page.renderer,
            help: engineVerdict.message,
            helpUrl: `https://act-rules.github.io/rules/${actRuleId}`,
          });
        }
      }

      pages.push({
        target: target.label,
        renderer: page.renderer,
        capabilities: [...page.capabilities].sort(),
        findings,
        results: reports.flatMap((r) => r.results),
        durationMs: Date.now() - started,
      });
    } finally {
      await page.close();
    }
  }

  const allResults = pages.flatMap((p) => p.results);
  const notEvaluated = allResults.filter(
    (r) => r.status === 'unsupported' && r.missingCapabilities.length > 0,
  );
  const notEvaluatedRules = [...new Set(notEvaluated.map((r) => r.actRuleId))];

  const coverage: Coverage = computeCoverage({
    implemented: [...IMPLEMENTED_RULES],
    calibrated: [...IMPLEMENTED_RULES].filter((id) =>
      options.table.entries.some(
        (e) => e.actRuleId === id && e.engine === 'marlo' && e.testCaseCount > 0,
      ),
    ),
    notEvaluated: notEvaluatedRules.map((actRuleId) => ({
      actRuleId,
      missing: [
        ...new Set(
          notEvaluated
            .filter((r) => r.actRuleId === actRuleId)
            .flatMap((r) => r.missingCapabilities),
        ),
      ],
    })),
  });

  const findings = pages.flatMap((p) => p.findings);
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    advisory: 0,
  };
  for (const finding of findings) bySeverity[finding.severity] += 1;

  return {
    schemaVersion: 1,
    runId: newRunId(),
    marloVersion: options.marloVersion,
    startedAt: new Date().toISOString(),
    calibration: {
      generated: options.table.generated,
      commit: options.table.commit,
      corpusRetrieved: options.table.corpus.retrieved,
    },
    engines: engines.map((e) => ({ id: e.id, version: e.version })),
    pages,
    repairs: [],
    coverage,
    totals: {
      findings: findings.length,
      bySeverity,
      fixed: 0,
      flagged: 0,
      errored: allResults.filter((r) => r.status === 'error').length,
      notEvaluated: notEvaluatedRules.length,
      withheld: { count: 0, reason: null },
    },
    invariantEnforced,
  };
}

/**
 * The exit code, which a script depends on more than it depends on the output.
 *
 * `incomplete` outranks `findings` deliberately. A run that could not evaluate part of what
 * it was asked about must not return the same code as a run that finished and found
 * problems, because a caller treating 1 as "there is work to do" would otherwise read an
 * incomplete measurement as a complete one.
 */
export function exitCodeFor(report: ScanReport, failOnNotEvaluated: boolean): number {
  if (report.totals.errored > 0) return EXIT_CODES.incomplete;
  if (failOnNotEvaluated && report.totals.notEvaluated > 0) return EXIT_CODES.incomplete;
  if (report.totals.findings > 0) return EXIT_CODES.findings;
  return EXIT_CODES.clean;
}
