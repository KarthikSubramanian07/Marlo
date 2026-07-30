import type { Finding, ScanReport } from '@marlo/schema';
import { findRule } from '@marlo/act';

/**
 * SARIF 2.1.0, with per-engine provenance on every result.
 *
 * The provenance is the part worth caring about. A SARIF file that says "accessibility
 * violation" tells a reviewer nothing about whether to believe it. Every result here
 * carries which engine reported it, which of that engine's own rules fired, that engine's
 * measured precision and recall for the ACT rule, and how many official test cases the
 * measurement rests on. A reader can decide how much weight to give a finding without
 * asking anyone.
 *
 * Rules that could not be evaluated appear as `notifications` with level `warning` rather
 * than being omitted. An omitted rule reads as a pass to every SARIF consumer there is.
 */

interface SarifRegion {
  startLine: number;
  startColumn: number;
  charOffset: number;
  charLength: number;
}

function regionOf(finding: Finding): SarifRegion | null {
  if (finding.source === null) return null;
  return {
    startLine: finding.source.line,
    startColumn: finding.source.column,
    charOffset: finding.source.start,
    charLength: finding.source.end - finding.source.start,
  };
}

const SEVERITY_TO_SARIF: Readonly<Record<Finding['severity'], string>> = Object.freeze({
  critical: 'error',
  serious: 'error',
  moderate: 'warning',
  advisory: 'note',
});

export function renderSarif(report: ScanReport): string {
  const findings = report.pages.flatMap((page) => page.findings);
  const ruleIds = [...new Set(findings.map((f) => f.actRuleId))].sort();

  const rules = ruleIds.map((actRuleId) => {
    const finding = findings.find((f) => f.actRuleId === actRuleId);
    const published = findRule(actRuleId);
    return {
      id: actRuleId,
      name: published?.name ?? finding?.actRuleName ?? actRuleId,
      shortDescription: { text: published?.name ?? actRuleId },
      fullDescription: {
        text: `ACT rule ${actRuleId}. ${published?.name ?? ''}`.trim(),
      },
      helpUri: `https://act-rules.github.io/rules/${actRuleId}`,
      properties: {
        // The success criteria come from the ACT rule's own metadata, not from Marlo's
        // reading of it.
        'wcag-success-criteria': published?.successCriteria ?? [],
        'act-rule-type': published?.ruleType ?? 'unknown',
        'official-test-cases': published?.testCases.total ?? 0,
      },
    };
  });

  const results = findings.map((finding) => {
    const region = regionOf(finding);
    return {
      ruleId: finding.actRuleId,
      level: SEVERITY_TO_SARIF[finding.severity],
      message: { text: finding.verdict.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: finding.source?.file ?? finding.verdict.target.selector,
            },
            ...(region === null ? {} : { region }),
          },
          logicalLocations: [{ name: finding.verdict.target.selector, kind: 'element' }],
        },
      ],
      partialFingerprints: {
        // Stable across runs and across line-number changes, so a suppression survives a
        // reformat of unrelated code.
        marloFinding: `${finding.actRuleId}:${finding.verdict.target.selector}`,
      },
      properties: {
        // The provenance. This is why the file is worth reading.
        'reported-by': finding.reportedBy,
        'engine-rule-id': finding.verdict.engineRuleId,
        'engine-version': finding.verdict.engineVersion,
        'routing-reason': finding.routingReason,
        'agreed-by': finding.agreedBy,
        disagreements: finding.disagreements.map((d) => ({
          engine: d.engine,
          outcome: d.outcome,
          'chosen-engine-strict-recall': d.chosenEngineStrictRecall,
        })),
        'measured-precision': finding.confidence.precision,
        'measured-recall': finding.confidence.recall,
        'official-test-cases-behind-measurement': finding.confidence.sampleSize,
        'accuracy-source': finding.confidence.source,
        'meets-auto-fix-threshold': finding.confidence.meetsAutoFixThreshold,
        renderer: finding.renderer,
        'located-in-source': finding.source !== null,
        ...(finding.locationNote === null ? {} : { 'location-note': finding.locationNote }),
      },
    };
  });

  // Rules that could not be evaluated. Notifications rather than omissions, because every
  // SARIF consumer treats an absent rule as a rule with nothing to say.
  const notifications = report.pages.flatMap((page) =>
    page.results
      .filter((r) => r.status !== 'ok')
      .map((r) => ({
        level: 'warning',
        message: {
          text:
            r.status === 'error'
              ? `${r.actRuleId} threw in ${r.engine} and was not evaluated: ${r.error ?? 'no message'}`
              : `${r.actRuleId} was not evaluated by ${r.engine}` +
                (r.missingCapabilities.length > 0
                  ? `: the ${page.renderer} renderer does not provide ${r.missingCapabilities.join(' and ')}. This is not a pass.`
                  : ': this engine does not implement it.'),
        },
        descriptor: { id: r.actRuleId },
        properties: {
          status: r.status,
          engine: r.engine,
          'missing-capabilities': r.missingCapabilities,
        },
      })),
  );

  const log = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Marlo',
            version: report.marloVersion,
            informationUri: 'https://trymarlo.pages.dev',
            rules,
            properties: {
              // Coverage travels with the file, as a fraction. A SARIF consumer that
              // wants a percentage has to divide, and will then have the denominator.
              'act-rules-implemented': report.coverage.implemented,
              'act-rules-published': report.coverage.publishedActRules,
              'act-rules-calibrated': report.coverage.calibrated,
              'act-rules-unmeasurable': report.coverage.unmeasurable,
              'calibration-generated': report.calibration.generated,
              'calibration-commit': report.calibration.commit,
              'corpus-retrieved': report.calibration.corpusRetrieved,
              engines: report.engines.map((e) => `${e.id}@${e.version}`),
            },
          },
        },
        invocations: [
          {
            executionSuccessful: true,
            startTimeUtc: report.startedAt,
            properties: { runId: report.runId },
            ...(notifications.length === 0 ? {} : { toolExecutionNotifications: notifications }),
          },
        ],
        results,
      },
    ],
  };

  return `${JSON.stringify(log, null, 2)}\n`;
}
