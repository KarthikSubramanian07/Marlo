import type { Coverage, ScanReport, Severity } from '@marlo/schema';
import { SEVERITY_PRESENTATION, formatCoverage } from '@marlo/schema';

/**
 * The terminal surface. One of the two things developers judge Marlo by.
 *
 * Three rules it follows, each a decision rather than a style preference.
 *
 * SEVERITY IS NEVER COLOUR ALONE. Every severity prints its text mark from
 * `SEVERITY_PRESENTATION`, so the output is complete without colour: in a pipe, in a CI
 * log, on a monochrome terminal, and for a reader who cannot distinguish red from amber.
 * Colour is added on top when the stream is a TTY and `NO_COLOR` is unset, and removing it
 * loses no information.
 *
 * WHAT WAS NOT EXAMINED IS AS PROMINENT AS WHAT WAS FOUND, and comes first. A run that
 * could not evaluate eleven rules says so above the findings rather than in a footnote.
 * "No contrast problems were found" and "contrast was not examined" are different
 * sentences, and this surface never blurs them.
 *
 * TRUNCATION ANNOUNCES ITSELF. A report listing five findings for a rule with forty
 * implies the rule has five. Borrowed from the sibling project, which had the same defect
 * and fixed it the same way.
 */

export interface TerminalOptions {
  /** Colour is opt-in and depends on the stream, never assumed. */
  readonly colour: boolean;
  /** Findings shown per rule before truncating. */
  readonly maxPerRule?: number;
  readonly width?: number;
}

const ESC = '[';
const ANSI = {
  reset: `${ESC}0m`,
  dim: `${ESC}2m`,
  bold: `${ESC}1m`,
  red: `${ESC}31m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  green: `${ESC}32m`,
} as const;

const SEVERITY_COLOUR: Readonly<Record<Severity, string>> = Object.freeze({
  critical: ANSI.red,
  serious: ANSI.red,
  moderate: ANSI.yellow,
  advisory: ANSI.blue,
});

/**
 * Decides whether to colour. Exported so the CLI does not reimplement the rules.
 *
 * `NO_COLOR` wins over everything, per no-color.org. `FORCE_COLOR` exists for CI that
 * supports colour without being a TTY, which is most of it.
 */
export function shouldUseColour(
  env: Readonly<Record<string, string | undefined>>,
  /** `process.stdout.isTTY`, which Node leaves undefined rather than false on a pipe. */
  isTty: boolean | undefined,
): boolean {
  const noColor = env['NO_COLOR'];
  if (noColor !== undefined && noColor !== '') return false;
  const forceColor = env['FORCE_COLOR'];
  if (forceColor !== undefined && forceColor !== '0') return true;
  if (env['TERM'] === 'dumb') return false;
  return isTty === true;
}

export function renderTerminal(report: ScanReport, options: TerminalOptions): string {
  const paint = (text: string, colour: string): string =>
    options.colour ? `${colour}${text}${ANSI.reset}` : text;
  const dim = (text: string): string => paint(text, ANSI.dim);
  const bold = (text: string): string => paint(text, ANSI.bold);

  const out: string[] = [];
  const maxPerRule = options.maxPerRule ?? 5;

  for (const page of report.pages) {
    out.push('');
    out.push(bold(page.target));
    out.push(dim(`  ${page.renderer} renderer  ${[...page.capabilities].sort().join(', ')}`));
    out.push('');

    // What was not examined comes first, deliberately. A reader who stops after the
    // findings must still have seen the gaps.
    const notEvaluated = page.results.filter(
      (r) => r.status === 'unsupported' && r.missingCapabilities.length > 0,
    );
    const uniqueNotEvaluated = [...new Set(notEvaluated.map((r) => r.actRuleId))].sort();
    if (uniqueNotEvaluated.length > 0) {
      const missing = [...new Set(notEvaluated.flatMap((r) => r.missingCapabilities))].sort();
      out.push(
        `  ${paint('NOT EXAMINED', ANSI.yellow)}  ${String(uniqueNotEvaluated.length)} rule${uniqueNotEvaluated.length === 1 ? '' : 's'} need ${missing.join(' and ')}, which this renderer does not provide.`,
      );
      out.push(dim(`                ${uniqueNotEvaluated.join(' ')}`));
      out.push(dim('                This is not a pass. Use --renderer browser to evaluate them.'));
      out.push('');
    }

    const errored = page.results.filter((r) => r.status === 'error');
    if (errored.length > 0) {
      out.push(
        `  ${paint('CRASHED', ANSI.red)}       ${String(errored.length)} rule${errored.length === 1 ? '' : 's'} threw, so they were not evaluated either.`,
      );
      for (const result of errored.slice(0, 3)) {
        out.push(
          dim(`                ${result.actRuleId} (${result.engine}): ${result.error ?? ''}`),
        );
      }
      out.push('');
    }

    if (page.findings.length === 0) {
      out.push(`  ${paint('no findings', ANSI.green)} for the rules that were evaluated.`);
      out.push('');
      continue;
    }

    // Grouped by rule, worst first, so a reader fixing one thing sees every instance.
    const byRule = new Map<string, typeof page.findings>();
    for (const finding of page.findings) {
      const list = byRule.get(finding.actRuleId) ?? [];
      list.push(finding);
      byRule.set(finding.actRuleId, list);
    }

    const order: readonly Severity[] = ['critical', 'serious', 'moderate', 'advisory'];
    const groups = [...byRule.entries()].sort((a, b) => {
      const sa = a[1][0]?.severity ?? 'advisory';
      const sb = b[1][0]?.severity ?? 'advisory';
      return order.indexOf(sa) - order.indexOf(sb) || a[0].localeCompare(b[0]);
    });

    for (const [actRuleId, findings] of groups) {
      const first = findings[0];
      if (first === undefined) continue;
      const presentation = SEVERITY_PRESENTATION[first.severity];

      out.push(
        `  ${paint(presentation.mark.padEnd(3), SEVERITY_COLOUR[first.severity])} ` +
          `${bold(presentation.label.padEnd(8))} ${actRuleId}  ${first.actRuleName}`,
      );

      const criteria =
        first.successCriteria.length > 0
          ? `WCAG ${first.successCriteria.join(', ')}`
          : 'no mapped success criterion';
      const confidence =
        first.confidence.precision === null
          ? 'accuracy not measured for this rule'
          : `${first.reportedBy} precision ${first.confidence.precision.toFixed(2)} over ${String(first.confidence.sampleSize)} official test cases`;
      out.push(dim(`      ${criteria}  ${confidence}`));

      if (first.routingReason === 'invariant') {
        // The most interesting thing that can happen in a run, so it is never dimmed.
        out.push(
          `      ${paint('INVARIANT', ANSI.yellow)} ${first.reportedBy} reported a failure the routed engine did not, so Marlo may not report clean.`,
        );
      }
      for (const disagreement of first.disagreements.slice(0, 2)) {
        out.push(dim(`      disagreement: ${disagreement.engine} says ${disagreement.outcome}`));
      }

      for (const finding of findings.slice(0, maxPerRule)) {
        const where =
          finding.source === null
            ? `${finding.verdict.target.selector} ${dim('(not located in source)')}`
            : `${finding.source.file}:${String(finding.source.line)}:${String(finding.source.column)}`;
        out.push(`      ${where}`);
        out.push(dim(`        ${finding.verdict.message}`));
      }

      if (findings.length > maxPerRule) {
        out.push(
          dim(`      and ${String(findings.length - maxPerRule)} more for this rule, not shown`),
        );
      }
      out.push('');
    }
  }

  out.push(renderSummary(report, options));
  return out.join('\n');
}

function renderSummary(report: ScanReport, options: TerminalOptions): string {
  const paint = (text: string, colour: string): string =>
    options.colour ? `${colour}${text}${ANSI.reset}` : text;
  const lines: string[] = [];
  const totals = report.totals;

  lines.push(`  ${'-'.repeat(Math.min(options.width ?? 72, 72))}`);
  lines.push(
    `  ${String(totals.findings)} finding${totals.findings === 1 ? '' : 's'}` +
      `   ${String(totals.fixed)} fixed   ${String(totals.flagged)} flagged` +
      `   ${String(totals.notEvaluated)} not evaluated   ${String(totals.errored)} crashed`,
  );
  lines.push(`  coverage: ${formatCoverage(report.coverage)}`);

  if (report.coverage.unmeasurable.length > 0) {
    lines.push(
      `  ${String(report.coverage.unmeasurable.length)} implemented rule(s) have no official test cases, so their accuracy is unmeasured: ${report.coverage.unmeasurable.join(' ')}`,
    );
  }

  if (totals.withheld.count > 0) {
    lines.push(
      `  ${String(totals.withheld.count)} finding(s) withheld: ${totals.withheld.reason ?? ''}`,
    );
  }

  if (report.invariantEnforced.length > 0) {
    lines.push(
      `  ${paint('one-directional invariant enforced', ANSI.yellow)} on ${String(report.invariantEnforced.length)} rule(s): a peer reported a failure the routed engine did not.`,
    );
  }

  lines.push(
    `  calibration ${report.calibration.generated}, corpus ${report.calibration.corpusRetrieved}`,
  );
  return lines.join('\n');
}

/** Coverage as the one sentence Marlo is allowed to state it in. */
export function coverageLine(coverage: Coverage): string {
  return formatCoverage(coverage);
}
