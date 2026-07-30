import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalibrationTable } from '@marlo/schema';
import { BrowserRenderer, StaticRenderer } from '@marlo/render';
import { peerEngines } from '@marlo/engines';
import { MarloEngine } from '@marlo/calibrate';
import { scan } from '@marlo/cli';

/**
 * The browser renderer, and the gap this file was written to close and instead exposed.
 *
 * WHAT WAS EXPECTED
 *
 * The static path has committed golden output and a CI job; the browser path had neither, so the
 * claim that the same rule set produces genuine results under a real browser rested on manual
 * runs. This was meant to be a golden file for it.
 *
 * WHAT IS ACTUALLY TRUE
 *
 * No engine can evaluate a Playwright page. Every adapter needs an in-process DOM window with an
 * `eval`, because that is how axe-core, Alfa and HTML CodeSniffer are run: their script is
 * evaluated inside the same JavaScript realm as the document. A Playwright page is a handle to a
 * document in a different process, and passing one to an adapter throws.
 *
 * So `BrowserRenderer` renders, and declares `layout` and `paint` truthfully about itself, and
 * nothing downstream can consume it. It is a rendering seam with no adapter behind it.
 *
 * HOW THE ARCHITECTURE HANDLES IT, WHICH IS THE GOOD NEWS
 *
 * `asWindow` in `@marlo/engines` was written for precisely this, and the two engine families deal
 * with it differently. Both are correct.
 *
 * The peer adapters catch it and report `status: 'error'` per rule, carrying the explanation
 * verbatim. `error` is never a pass anywhere in this codebase, so the pipeline reports "13 rules
 * threw" rather than a clean page, which is the same mechanism that made the HTML CodeSniffer
 * crash loud rather than silent.
 *
 * `MarloEngine` validates the handle before it returns a promise, so it throws synchronously.
 *
 * WHY IT WENT UNNOTICED ANYWAY
 *
 * That guard had never once been reached. `marlo scan --renderer browser` refuses before it gets
 * there, and no test had ever asked for it. A guard nothing reaches protects nothing, and a
 * limitation nobody wrote down is indistinguishable from a limitation that is not there.
 *
 * This file writes it down, and it fails the moment somebody makes the browser path work, which
 * is the point.
 *
 * The remaining work is in issue #37: run each engine inside the page rather than beside it. That
 * is what `pnpm screenshots` already does for axe-core, and doing it for four engines needs a
 * bundle step for each.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const table = CalibrationTable.parse(
  JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
);
const CHECKOUT = resolve(ROOT, 'apps/demo/checkout.html');

let renderer: BrowserRenderer;

beforeAll(() => {
  renderer = new BrowserRenderer();
});

afterAll(async () => {
  await renderer.dispose();
  // A second dispose has to be safe: CI reaches this after a failing test too.
  await renderer.dispose();
});

describe('what the browser renderer can do', () => {
  it('renders a real file and declares the two capabilities the static path lacks', async () => {
    const page = await renderer.render({ path: CHECKOUT });
    try {
      expect(page.renderer).toBe('browser');
      expect(page.capabilities).toContain('dom');
      expect(page.capabilities).toContain('script');
      // The two the contrast and focus rules need, and the reason this renderer exists.
      expect(page.capabilities).toContain('layout');
      expect(page.capabilities).toContain('paint');
    } finally {
      await page.close();
    }
  }, 180_000);

  it('resolves a style the static renderer cannot compute at all', async () => {
    // Proof the `layout` capability is about something real rather than a label. The demo page
    // sets letter-spacing in em, which a Node DOM returns as the string it was given and a real
    // browser resolves to pixels.
    //
    // The handle is a Playwright Page. The seam deliberately types it as `unknown`, because the
    // whole point of the capability model is that a consumer asks what a renderer can do rather
    // than what it is, and a test reaching through it has to say so.
    const page = await renderer.render({ path: CHECKOUT });
    try {
      const handle = page.handle as { evaluate: (fn: string) => Promise<unknown> };
      const resolved = String(
        await handle.evaluate(`getComputedStyle(document.querySelector('p[style]')).letterSpacing`),
      );
      expect(resolved).not.toBe('');
      expect(
        resolved,
        'a resolved letter-spacing is in pixels, not the em it was written in',
      ).toMatch(/px$/);
    } finally {
      await page.close();
    }
  }, 180_000);
});

describe('what the browser renderer cannot do yet, stated so it is not folklore', () => {
  it('cannot be evaluated by any engine, and no engine reports a pass', async () => {
    const page = await renderer.render({ path: CHECKOUT });
    try {
      for (const engine of [new MarloEngine(), ...peerEngines()]) {
        // Two honest shapes, and the assertion is the same for both: nothing comes back as a
        // verdict. MarloEngine throws before it returns a promise. The peer adapters catch the
        // guard and report status 'error' per rule, which is never a pass anywhere, so the
        // pipeline says the rules threw rather than that the page is clean.
        //
        // What must never happen is a report full of inapplicable or passed, which is what
        // `asWindow` exists to prevent and what this asserts it prevents.
        let thrown: string | null = null;
        let report: Awaited<ReturnType<typeof engine.evaluate>> | null = null;
        try {
          report = await engine.evaluate(page, ['b5c3f8', 'e086e5', '97a4e1']);
        } catch (error) {
          thrown = error instanceof Error ? error.message : String(error);
        }

        if (thrown !== null) {
          expect(thrown, `${engine.id} failed without saying why`).toMatch(/DOM window/i);
          continue;
        }

        expect(report, `${engine.id} returned nothing at all`).not.toBeNull();
        for (const result of report?.results ?? []) {
          expect(
            result.status,
            `${engine.id} reported ${result.actRuleId} as ${result.status} against a page it ` +
              'cannot read',
          ).toBe('error');
          expect(
            result.verdicts,
            `${engine.id} produced a verdict it could not have earned`,
          ).toEqual([]);
          expect(result.error ?? '', `${engine.id} errored without saying why`).toMatch(
            /DOM window/i,
          );
        }
      }
    } finally {
      await page.close();
    }
  }, 180_000);

  it('makes the whole pipeline fail rather than report a clean page', async () => {
    // The assertion that matters most. If this ever starts passing without the engines being
    // reworked, something has begun swallowing the error above, and a swallowed error here means
    // Marlo reports a page with 34 findings as having none.
    await expect(
      scan({
        targets: [{ label: 'apps/demo/checkout.html', path: CHECKOUT }],
        renderer,
        table,
        marloVersion: '0.1.0',
      }),
    ).rejects.toThrow();
  }, 180_000);

  it('is not reachable from the command line, so nobody meets this by accident', () => {
    // `marlo scan --renderer browser` refuses with an explanation. That refusal is why the guard
    // above had never been reached in the first place.
    const bin = readFileSync(resolve(ROOT, 'packages/cli/src/bin.ts'), 'utf8');
    expect(bin).toContain('the browser renderer needs Playwright');
  });

  it('leaves the static renderer as the only one that produces a report', async () => {
    // The honest fallback, and the reason none of the above is a live defect for a user: the
    // default path works, and the rules that need layout are reported as not evaluated rather
    // than as passing.
    const staticRenderer = new StaticRenderer();
    try {
      const report = await scan({
        targets: [{ label: 'apps/demo/checkout.html', path: CHECKOUT }],
        renderer: staticRenderer,
        table,
        marloVersion: '0.1.0',
      });
      expect(report.pages[0]?.findings.length).toBeGreaterThan(0);
      expect(report.coverage.notEvaluated.length).toBeGreaterThan(0);
    } finally {
      await staticRenderer.dispose();
    }
  }, 180_000);
});
