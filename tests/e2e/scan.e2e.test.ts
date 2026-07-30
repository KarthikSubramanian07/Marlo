/**
 * The whole pipeline, against real files on disk, compared to committed output.
 *
 * Unit tests hold each package to its contract. They did not catch the HTML CodeSniffer
 * adapter treating a DOM node as a string (13 rules threw), and they did not catch the JSON
 * report truncating at 65526 bytes on a pipe. Both of those needed a real page and a real
 * process. So this exists.
 *
 * The golden files are committed. Run with UPDATE_GOLDEN=1 to rewrite them, then read the
 * diff before you commit it. A golden diff nobody read is a golden file that has stopped
 * checking anything.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StaticRenderer } from '@marlo/render';
import { renderSarif, renderTerminal } from '@marlo/report';
import { scan } from '@marlo/cli';
import { CalibrationTable } from '@marlo/schema';

const ROOT = resolve(import.meta.dirname, '..', '..');
const GOLDEN = resolve(ROOT, 'tests/golden');
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

const table = CalibrationTable.parse(
  JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
);

/**
 * The four fields that change on every run: the run id, the wall clock in two places, and
 * the elapsed time. Each is replaced with a fixed token so the golden file compares what is
 * supposed to be stable.
 *
 * Deliberately narrow. An earlier version replaced every `"version"` field, which quietly
 * rewrote SARIF's own `"version": "2.1.0"` and broke the assertion that the output is valid
 * SARIF rather than merely unchanged SARIF. Engine versions are pinned, so they belong in the
 * golden file: if axe-core moves, the diff should say so.
 */
function stabilise(text: string): string {
  return text
    .replace(/"runId": "[0-9a-f]+"/g, '"runId": "<run>"')
    .replace(/"startedAt": "[^"]+"/g, '"startedAt": "<time>"')
    .replace(/"startTimeUtc": "[^"]+"/g, '"startTimeUtc": "<time>"')
    .replace(/"durationMs": \d+/g, '"durationMs": 0');
}

function golden(name: string, actual: string): void {
  const path = resolve(GOLDEN, name);
  if (UPDATE || !existsSync(path)) {
    writeFileSync(path, actual, 'utf8');
    return;
  }
  expect(actual, `${name} differs. Run UPDATE_GOLDEN=1 pnpm test:e2e and read the diff.`).toBe(
    readFileSync(path, 'utf8'),
  );
}

const report = await scan({
  targets: [
    { label: 'apps/demo/checkout.html', path: resolve(ROOT, 'apps/demo/checkout.html') },
    { label: 'apps/demo/settings.html', path: resolve(ROOT, 'apps/demo/settings.html') },
  ],
  renderer: new StaticRenderer(),
  table,
  marloVersion: '0.1.0',
});

const expected = JSON.parse(readFileSync(resolve(ROOT, 'apps/demo/expected.json'), 'utf8')) as {
  mustFail: Record<string, string>;
  mustNotEvaluate: Record<string, string>;
};

describe('the pipeline against the demo pages', () => {
  it('finds a violation for every rule the demo page is built to break', () => {
    const fired = new Set(report.pages.flatMap((p) => p.findings.map((f) => f.actRuleId)));
    const missing = Object.keys(expected.mustFail).filter((id) => !fired.has(id));
    expect(
      missing,
      `apps/demo has defects for these rules and nothing reported them: ${missing.join(' ')}`,
    ).toEqual([]);
  });

  it('reports the layout-dependent rules as not evaluated rather than as passing', () => {
    const notEvaluated = new Set(report.coverage.notEvaluated.map((r) => r.actRuleId));
    for (const id of Object.keys(expected.mustNotEvaluate)) {
      expect(notEvaluated.has(id), `${id} should be not evaluated on the static renderer`).toBe(
        true,
      );
    }
    // The stronger half of the claim, and the one the capability model exists for: Marlo's
    // own engine returns `unsupported` for these rules on this renderer, never a pass.
    //
    // Peer engines are a different matter and are deliberately not asserted here. Alfa does
    // return a verdict for minimum contrast from the declared colours alone, the invariant
    // forces that failure through, and both of those are correct. What must never happen is
    // Marlo answering "no contrast problems" when it has no layout to look at.
    const marloPassed = report.pages
      .flatMap((p) => p.results)
      .filter(
        (r) =>
          r.engine === 'marlo' &&
          Object.hasOwn(expected.mustNotEvaluate, r.actRuleId) &&
          r.status === 'ok' &&
          r.verdicts.some((v) => v.outcome === 'passed'),
      )
      .map((r) => r.actRuleId);
    expect(marloPassed).toEqual([]);
  });

  it('crashes nowhere', () => {
    // This is the assertion that would have caught the HTML CodeSniffer defect. An adapter
    // that throws is loud rather than silent, but 13 unmeasured rules still shipped.
    const errored = report.pages
      .flatMap((p) => p.results)
      .filter((r) => r.status === 'error')
      .map((r) => `${r.actRuleId} (${r.engine})`);
    expect(errored).toEqual([]);
  });

  it('never reports clean where a peer engine reported a failure', () => {
    // The one-directional invariant, on real markup rather than on the 256 synthetic
    // combinations the unit test covers.
    for (const page of report.pages) {
      const failedByAnyone = new Set(
        page.results
          .filter((r) => r.status === 'ok' && r.verdicts.some((v) => v.outcome === 'failed'))
          .map((r) => r.actRuleId),
      );
      const reported = new Set(page.findings.map((f) => f.actRuleId));
      const swallowed = [...failedByAnyone].filter((id) => !reported.has(id));
      expect(swallowed, `${page.target}: a peer failure went unreported`).toEqual([]);
    }
  });

  it('attaches measured provenance to every finding', () => {
    for (const finding of report.pages.flatMap((p) => p.findings)) {
      expect(finding.reportedBy, finding.actRuleId).toBeTruthy();
      if (finding.confidence.source === 'calibrated') {
        expect(finding.confidence.sampleSize, finding.actRuleId).toBeGreaterThan(0);
      }
    }
  });
});

describe('the committed output', () => {
  it('matches the terminal golden file', () => {
    golden('checkout-terminal.txt', `${stabilise(renderTerminal(report, { colour: false }))}\n`);
  });

  it('matches the SARIF golden file', () => {
    const sarif = stabilise(renderSarif(report));
    golden('checkout-sarif.json', sarif);
    // Valid SARIF, not just stable SARIF.
    const parsed = JSON.parse(sarif) as { version: string; runs: { results: unknown[] }[] };
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0]?.results.length).toBeGreaterThan(0);
  });

  it('matches the JSON report golden file', () => {
    golden('checkout-report.json', `${stabilise(JSON.stringify(report, null, 2))}\n`);
  });
});

describe('the command line, as a process', () => {
  const bin = resolve(ROOT, 'packages/cli/dist/bin.js');

  it.runIf(existsSync(bin))('writes JSON through a pipe without truncating it', () => {
    // The regression test for the 65526 byte truncation. The pipe is the whole point:
    // console.log is synchronous to a terminal and asynchronous to a pipe, and only the
    // second one loses the tail. `| cat` is what makes stdout a pipe.
    const out = execSync(
      `node ${JSON.stringify(bin)} scan apps/demo/checkout.html apps/demo/settings.html --json | cat`,
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    expect(out.length).toBeGreaterThan(65_536);
    expect(() => JSON.parse(out) as unknown).not.toThrow();
  });

  it.runIf(existsSync(bin))('exits 1 on a page with findings', () => {
    let code = 0;
    try {
      execFileSync('node', [bin, 'scan', 'apps/demo/checkout.html'], {
        cwd: ROOT,
        stdio: 'ignore',
      });
    } catch (error) {
      code = (error as { status: number }).status;
    }
    expect(code).toBe(1);
  });
});
