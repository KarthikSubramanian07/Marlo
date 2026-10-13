import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CalibrationTable } from '@marlo/schema';
import { BrowserRenderer } from '@marlo/render';
import { renderSarif, renderTerminal } from '@marlo/report';
import { calibrationTableFor, scan } from '@marlo/cli';

/**
 * The whole pipeline through a real browser, compared to committed output.
 *
 * The static path has `scan.e2e.test.ts` and `tests/golden`. This is the same test with
 * the other renderer: the same demo pages go through Chromium, every engine is evaluated
 * inside the page rather than beside it, and the output is committed under
 * `tests/golden/browser`. A divergence between the two paths shows up as a diff between
 * the two golden sets rather than as a mystery.
 *
 * They are meant to diverge, and in one direction in particular. The two contrast rules
 * are `unsupported` on the static renderer because contrast needs layout. Here they are
 * evaluated, and the assertions below say so in both directions: nothing is reported as
 * not evaluated, and every rule the demo page is built to break still fires.
 *
 * An earlier version of this file asserted the opposite. No engine could evaluate a
 * Playwright page, and the test wrote that limitation down so it was not folklore, with
 * the comment that it would fail the day somebody made the browser path work. That is
 * HONESTY.md entry 9, and this file is what replaced it when the day came.
 *
 * The golden files are committed. Run with UPDATE_GOLDEN=1 to rewrite them, then read the
 * diff before you commit it. This project needs Playwright and a built tree: the Alfa and
 * Marlo bundles come from `pnpm build`, and without them those two adapters report every
 * rule as errored, which the first assertion catches.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const GOLDEN = resolve(ROOT, 'tests/golden/browser');
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

const choice = calibrationTableFor('browser', (relative) => existsSync(resolve(ROOT, relative)));
const table = CalibrationTable.parse(
  JSON.parse(readFileSync(resolve(ROOT, choice.relative), 'utf8')),
);

/** The same four fields `scan.e2e.test.ts` replaces, for the same reason. */
function stabilise(text: string): string {
  return text
    .replace(/"runId": "[0-9a-f]+"/g, '"runId": "<run>"')
    .replace(/"startedAt": "[^"]+"/g, '"startedAt": "<time>"')
    .replace(/"startTimeUtc": "[^"]+"/g, '"startTimeUtc": "<time>"')
    .replace(/"durationMs": \d+/g, '"durationMs": 0');
}

function golden(name: string, actual: string): void {
  mkdirSync(GOLDEN, { recursive: true });
  const path = resolve(GOLDEN, name);
  if (UPDATE || !existsSync(path)) {
    writeFileSync(path, actual, 'utf8');
    return;
  }
  expect(
    actual,
    `browser/${name} differs. Run UPDATE_GOLDEN=1 pnpm test:browser and read the diff.`,
  ).toBe(readFileSync(path, 'utf8'));
}

const renderer = new BrowserRenderer();

async function scanWith(targets: readonly string[]): ReturnType<typeof scan> {
  try {
    return await scan({
      targets: targets.map((t) => ({ label: t, path: resolve(ROOT, t) })),
      renderer,
      table,
      marloVersion: '0.1.0',
    });
  } catch (error) {
    // A failure here is a failed file, and the browser has to go down with it or the
    // worker hangs on an open Chromium.
    await renderer.dispose();
    throw error;
  }
}

const report = await scanWith(['apps/demo/checkout.html', 'apps/demo/settings.html']);
const clean = await scanWith(['apps/demo/clean.html']);

afterAll(async () => {
  await renderer.dispose();
  // A second dispose has to be safe: CI reaches this after a failing test too.
  await renderer.dispose();
});

const expected = JSON.parse(readFileSync(resolve(ROOT, 'apps/demo/expected.json'), 'utf8')) as {
  mustFail: Record<string, string>;
  mustNotEvaluate: Record<string, string>;
};

describe('the pipeline through a real browser', () => {
  it('reads the table measured with the same renderer', () => {
    // A browser scan with the static table's confidence figures would attach a
    // measurement to findings that measurement never covered. The browser table is
    // committed, so the fallback is a defect here rather than a convenience.
    expect(choice.fellBack, 'calibration/browser.json is missing').toBe(false);
    expect(table.renderer).toBe('browser');
  });

  it('declares every capability on every page', () => {
    for (const page of report.pages) {
      expect(page.renderer).toBe('browser');
      expect(page.capabilities).toEqual(['dom', 'layout', 'paint', 'script']);
    }
  });

  it('crashes nowhere, in any of the four engines', () => {
    // The assertion that would have caught every adapter handed a handle it could not
    // read, which is what every adapter was until this path existed. It also catches a
    // missing bundle: the Alfa and Marlo adapters report an error naming `pnpm build`.
    const errored = report.pages
      .flatMap((p) => p.results)
      .filter((r) => r.status === 'error')
      .map((r) => `${r.actRuleId} (${r.engine}): ${r.error ?? ''}`);
    expect(errored).toEqual([]);
  });

  it('finds a violation for every rule the demo page is built to break', () => {
    const fired = new Set(report.pages.flatMap((p) => p.findings.map((f) => f.actRuleId)));
    const missing = Object.keys(expected.mustFail).filter((id) => !fired.has(id));
    expect(
      missing,
      `apps/demo has defects for these rules and nothing reported them: ${missing.join(' ')}`,
    ).toEqual([]);
  });

  it('evaluates the layout rules instead of declining them', () => {
    // The point of the renderer. On the static path these two are the `mustNotEvaluate`
    // set; here nothing is not evaluated, and Marlo's own engine returns a verdict for
    // each rather than `unsupported`. What verdict it returns is measured, not asserted:
    // the calibration table under calibration/browser.json records it.
    expect(report.coverage.notEvaluated).toEqual([]);
    expect(report.totals.notEvaluated).toBe(0);
    for (const id of Object.keys(expected.mustNotEvaluate)) {
      const marlo = report.pages
        .flatMap((p) => p.results)
        .filter((r) => r.engine === 'marlo' && r.actRuleId === id);
      expect(marlo.length, `${id} has no Marlo result`).toBeGreaterThan(0);
      for (const result of marlo) {
        expect(result.status, `${id} on the browser renderer`).toBe('ok');
        expect(result.missingCapabilities).toEqual([]);
      }
    }
  });

  it('never reports clean where a peer engine reported a failure', () => {
    // The one-directional invariant, on real markup, with every engine evaluated.
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

  it('keeps a selector and a snippet on every verdict that crossed out of the page', () => {
    // The serialisation boundary is part of the contract. A finding that lost its
    // selector on the way out of the page is a finding a developer cannot act on.
    for (const result of report.pages.flatMap((p) => p.results)) {
      for (const verdict of result.verdicts) {
        expect(verdict.target.selector, `${result.engine} ${result.actRuleId}`).not.toBe('');
        if (verdict.outcome === 'failed') {
          expect(
            verdict.target.selector,
            `${result.engine} ${result.actRuleId} failed with no location`,
          ).not.toBe(':root');
        }
      }
    }
  });
});

describe('the page with nothing wrong with it, through a real browser', () => {
  it('reports nothing, and this time has nothing left unchecked', () => {
    const findings = clean.pages.flatMap((p) => p.findings);
    expect(
      findings.map((f) => `${f.actRuleId} ${f.reportedBy} ${f.verdict.target.selector}`),
      'a false positive on the clean page',
    ).toEqual([]);

    // On the static path zero findings is only honest alongside the two rules that could
    // not be evaluated. Here every rule was evaluated, so the not-evaluated list is empty
    // and the terminal output does not have to warn about it.
    expect(clean.coverage.notEvaluated).toEqual([]);
    expect(renderTerminal(clean, { colour: false })).toContain('no findings');

    const errored = clean.pages.flatMap((p) => p.results).filter((r) => r.status === 'error');
    expect(errored).toEqual([]);
  });
});

describe('the committed browser output', () => {
  it('matches the terminal golden file', () => {
    golden('checkout-terminal.txt', `${stabilise(renderTerminal(report, { colour: false }))}\n`);
  });

  it('matches the SARIF golden file', () => {
    const sarif = stabilise(renderSarif(report));
    golden('checkout-sarif.json', sarif);
    const parsed = JSON.parse(sarif) as { version: string; runs: { results: unknown[] }[] };
    expect(parsed.version).toBe('2.1.0');
    expect(parsed.runs[0]?.results.length).toBeGreaterThan(0);
  });

  it('matches the JSON report golden file', () => {
    golden('checkout-report.json', `${stabilise(JSON.stringify(report, null, 2))}\n`);
  });

  it('matches the clean page golden file', () => {
    // The static path has no golden for the clean page. This one is worth having,
    // because the clean page is where a false positive from a newly evaluated layout
    // rule would show up first.
    golden('clean-report.json', `${stabilise(JSON.stringify(clean, null, 2))}\n`);
  });
});
