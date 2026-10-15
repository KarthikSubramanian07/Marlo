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
import { decideRule, uncoveredPeerFailures } from '@marlo/report';
import { severityOf } from './severity.js';

/**
 * The scan pipeline: render, run every engine, route, apply the invariant, report.
 *
 * Repair is not wired in. The `fix` verb is the next branch, and the CLI's help text says
 * so rather than offering a flag that silently does nothing.
 */

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
        const routed = options.table.routing.find((r) => r.actRuleId === actRuleId);

        const confidenceOf = (engine: Finding['reportedBy']): Finding['confidence'] => {
          const measured = options.table.entries.find(
            (e) => e.actRuleId === actRuleId && e.engine === engine,
          );
          return {
            source:
              measured === undefined || measured.testCaseCount === 0
                ? 'uncalibrated'
                : 'calibrated',
            precision: measured?.strict.precision ?? null,
            recall: measured?.strict.recall ?? null,
            sampleSize: measured?.testCaseCount ?? 0,
            meetsAutoFixThreshold: engine === routed?.chosen && routed.autoFixPermitted,
          };
        };

        const findingFor = (
          engineVerdict: Finding['verdict'],
          fields: Pick<Finding, 'reportedBy' | 'routingReason' | 'agreedBy' | 'disagreements'>,
        ): Finding => ({
          id: `${actRuleId}-${String(findings.filter((f) => f.actRuleId === actRuleId).length)}`,
          actRuleId,
          actRuleName: published?.name ?? actRuleId,
          successCriteria: [...(published?.successCriteria ?? [])],
          severity: severityOf(actRuleId),
          ...fields,
          verdict: engineVerdict,
          confidence: confidenceOf(fields.reportedBy),
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

        // One finding per failing element, so a fix has somewhere to land.
        const source = verdict.evidence.find((r) => r.engine === verdict.reportedBy);
        const failing = (source?.verdicts ?? []).filter((v) => v.outcome === 'failed');
        for (const engineVerdict of failing) {
          findings.push(
            findingFor(engineVerdict, {
              reportedBy: verdict.reportedBy,
              routingReason: verdict.routingReason,
              agreedBy: [...verdict.agreedBy],
              disagreements: [...verdict.disagreements],
            }),
          );
        }

        // The invariant, per element. A peer that failed an element the findings above do
        // not include gets that element reported, attributed to the peer and routed as
        // `invariant`, with the engines that judged it otherwise recorded as dissent.
        const routedRecall =
          routed?.chosen === null || routed?.chosen === undefined
            ? null
            : (options.table.entries.find(
                (e) => e.actRuleId === actRuleId && e.engine === routed.chosen,
              )?.strict.recall ?? null);
        for (const uncovered of uncoveredPeerFailures(verdict.evidence, verdict.reportedBy)) {
          const dissenter = uncovered.verdict.engine;
          if (
            !invariantEnforced.some(
              (e) => e.actRuleId === actRuleId && e.dissentingEngine === dissenter,
            )
          ) {
            invariantEnforced.push({
              actRuleId,
              dissentingEngine: dissenter,
              chosenEngine: routed?.chosen ?? 'marlo',
            });
          }
          findings.push(
            findingFor(uncovered.verdict, {
              reportedBy: dissenter,
              routingReason: 'invariant',
              agreedBy: [...uncovered.agreedBy],
              disagreements: uncovered.dissent.map((d) => ({
                engine: d.engine,
                engineRuleId: d.engineRuleId,
                outcome: d.outcome,
                message: d.message,
                chosenEngineStrictRecall: routedRecall,
              })),
            }),
          );
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
