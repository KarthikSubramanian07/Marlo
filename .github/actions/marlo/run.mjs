#!/usr/bin/env node
/**
 * Runs the scan and writes the outputs, the job summary and the optional SARIF.
 *
 * Nothing here writes to the repository. The only files it creates are inside the runner's
 * temporary directory and the SARIF path the caller asked for, and there is no git command in
 * this file at all. See check-scopes.mjs for why that boundary is enforced by a permission
 * rather than by this comment.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const targets = (process.env['MARLO_TARGETS'] ?? '').split(' ').filter((t) => t !== '');
const renderer = process.env['MARLO_RENDERER'] ?? 'static';
const failOn = process.env['MARLO_FAIL_ON'] ?? 'serious';
const failOnNotEvaluated = process.env['MARLO_FAIL_ON_NOT_EVALUATED'] === 'true';
const sarifFile = (process.env['MARLO_SARIF_FILE'] ?? '').trim();

const RANK = { critical: 4, serious: 3, moderate: 2, advisory: 1, never: 0 };

function output(key, value) {
  const path = process.env['GITHUB_OUTPUT'];
  if (path === undefined) {
    console.log(`${key}=${value}`);
    return;
  }
  appendFileSync(path, `${key}=${value}\n`, 'utf8');
}

function summary(markdown) {
  const path = process.env['GITHUB_STEP_SUMMARY'];
  if (path !== undefined) appendFileSync(path, `${markdown}\n`, 'utf8');
}

const scratch = mkdtempSync(join(tmpdir(), 'marlo-action-'));
const reportFile = join(scratch, 'report.md');
output('report-file', reportFile);

if (targets.length === 0) {
  console.log('marlo: no HTML files to scan.');
  output('findings', '0');
  output('not-evaluated', '0');
  output('coverage', 'nothing scanned');
  output('sarif', '');
  summary('### Marlo\n\nNo HTML files changed, so nothing was scanned.');
  writeFileSync(reportFile, '', 'utf8');
  process.exit(0);
}

const bin = resolve(ROOT, 'packages/cli/dist/bin.js');
const args = ['scan', ...targets, '--json', '--renderer', renderer];

/**
 * Runs the CLI and returns stdout, treating a non-zero exit as normal.
 *
 * `marlo scan` exits 1 when it finds something, which is the tool working. execFileSync throws
 * on any non-zero exit, so a naive call loses the entire report on exactly the runs that have
 * one. The first version of this file wrapped the JSON call and not the SARIF call, and the
 * result was a job that emitted its outputs and then silently produced no SARIF and no summary
 * on every page that had a finding. Which is to say: it worked perfectly on clean pages.
 *
 * stdio is piped rather than inherited because stdout is the payload.
 */
function capture(extraArgs) {
  try {
    return execFileSync('node', [bin, ...extraArgs], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    const e = /** @type {{ status?: number, stdout?: string, stderr?: string }} */ (error);
    if (typeof e.stdout === 'string' && e.stdout.trim() !== '') return e.stdout;
    console.error(`marlo: the scan failed to run.\n${e.stderr ?? String(error)}`);
    process.exitCode = 2;
    process.exit();
  }
}

const json = capture(args);

const report = JSON.parse(json);
const findings = report.pages.flatMap((page) => page.findings);
const notEvaluated = report.coverage.notEvaluated;
const errored = report.pages
  .flatMap((page) => page.results)
  .filter((result) => result.status === 'error');

const threshold = RANK[failOn] ?? RANK.serious;
const blocking = findings.filter((finding) => (RANK[finding.severity] ?? 0) >= threshold);

const coverage = `${String(report.coverage.implemented)} of ${String(report.coverage.publishedActRules)} published ACT rules`;
output('findings', String(blocking.length));
output('not-evaluated', String(notEvaluated.length));
output('coverage', coverage);

if (sarifFile !== '') {
  writeFileSync(
    sarifFile,
    capture(['scan', ...targets, '--sarif', '--renderer', renderer]),
    'utf8',
  );
  output('sarif', sarifFile);
} else {
  output('sarif', '');
}

/* ── The report, which is also the pull request comment ──────────────────────── */

const lines = [];
lines.push('### Marlo accessibility scan');
lines.push('');

// What was not examined, before what was found. Every surface Marlo has does this, and the
// reason is that "no contrast problems were found" and "contrast was not examined" are
// different sentences.
if (notEvaluated.length > 0) {
  lines.push(
    `> **${String(notEvaluated.length)} rule(s) were not evaluated.** The \`${renderer}\` renderer ` +
      `does not provide a capability they need. This is not a pass.`,
  );
  lines.push('>');
  for (const rule of notEvaluated) {
    lines.push(`> \`${rule.actRuleId}\` needs ${rule.missing.join(', ')}`);
  }
  if (renderer === 'static') {
    lines.push('>');
    lines.push('> Set `renderer: browser` to evaluate them.');
  }
  lines.push('');
}

if (errored.length > 0) {
  lines.push(
    `> **${String(errored.length)} rule(s) threw.** Those rules are unmeasured on this run: ` +
      errored.map((r) => `\`${r.actRuleId}\` (${r.engine})`).join(', '),
  );
  lines.push('');
}

if (findings.length === 0) {
  lines.push(
    `No violations among the rules that were evaluated. Coverage is ${coverage}, and automation ` +
      'reaches a minority of WCAG regardless, so this is evidence about those rules and not a ' +
      'statement about the page.',
  );
} else {
  lines.push('| | Rule | Severity | Reported by | Accuracy |');
  lines.push('|---|---|---|---|---|');
  for (const finding of findings) {
    const confidence =
      finding.confidence.source === 'calibrated' && finding.confidence.precision !== null
        ? `precision ${finding.confidence.precision.toFixed(2)} over ${String(finding.confidence.sampleSize)} cases`
        : 'not calibrated';
    lines.push(
      `| \`${finding.verdict.target.selector}\` | [\`${finding.actRuleId}\`](${finding.helpUrl}) ` +
        `${finding.actRuleName} | ${finding.severity} | ${finding.reportedBy} | ${confidence} |`,
    );
  }
  lines.push('');
  for (const finding of findings.filter((f) => f.disagreements.length > 0)) {
    lines.push(
      `\`${finding.actRuleId}\`: ${finding.reportedBy} reported this and ` +
        finding.disagreements.map((d) => `${d.engine} said ${d.outcome}`).join(', ') +
        '. The one-directional invariant sends a peer failure through rather than dropping it.',
    );
  }
}

lines.push('');
lines.push(
  `Coverage ${coverage}. Calibration generated ${report.calibration.generated}, corpus retrieved ` +
    `${report.calibration.corpusRetrieved}. Automated analysis, not legal certification.`,
);
lines.push('');
lines.push(
  'Marlo does not commit, push, merge or deploy. This job refuses a token with ' +
    '`contents: write`.',
);

const markdown = lines.join('\n');
writeFileSync(reportFile, markdown, 'utf8');
summary(markdown);
console.log(markdown);

if (blocking.length > 0) {
  console.error(`\nmarlo: ${String(blocking.length)} finding(s) at or above ${failOn}.`);
  process.exitCode = 1;
} else if (failOnNotEvaluated && notEvaluated.length > 0) {
  console.error(
    `\nmarlo: ${String(notEvaluated.length)} rule(s) could not be evaluated and ` +
      'fail-on-not-evaluated is set.',
  );
  process.exitCode = 3;
}
