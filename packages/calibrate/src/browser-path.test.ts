import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineReport } from '@trymarlo/schema';
import type { RenderedPage } from '@trymarlo/render';
import { StaticRenderer } from '@trymarlo/render';

import { evaluate } from './marlo-browser-entry.js';
import { MarloEngine, marloBundlePath } from './marlo-engine.js';

/**
 * MarloEngine's browser path, without a browser.
 *
 * The engine injects `dist/marlo.browser.js` and asks it for a finished report. A fake
 * page that claims the bundle is already present and hands back a canned report exercises
 * everything on this side of Chromium: the probe, the call, and the validation of what
 * came back. The real page is covered by tests/e2e/browser.browser.test.ts.
 */

function fakePage(result: unknown): {
  readonly evaluated: string[];
  evaluate(expression: string): Promise<unknown>;
  addScriptTag(options: { readonly content: string }): Promise<unknown>;
} {
  const evaluated: string[] = [];
  return {
    evaluated,
    evaluate(expression: string): Promise<unknown> {
      evaluated.push(expression);
      if (expression.startsWith('typeof globalThis[')) return Promise.resolve('object');
      return Promise.resolve(result);
    },
    addScriptTag(): Promise<unknown> {
      return Promise.resolve(undefined);
    },
  };
}

function pageOf(handle: unknown): RenderedPage {
  return {
    renderer: 'browser',
    capabilities: new Set(['dom', 'script', 'layout', 'paint']),
    url: 'https://marlo.invalid/',
    html: '<html></html>',
    sourcePath: null,
    handle,
    serialize: () => '<html></html>',
    close: () => Promise.resolve(),
  };
}

const canned: EngineReport = {
  engine: 'marlo',
  engineVersion: '0.1.0',
  renderer: 'browser',
  results: [
    {
      actRuleId: 'b5c3f8',
      engine: 'marlo',
      status: 'ok',
      verdicts: [
        {
          engine: 'marlo',
          engineVersion: '0.1.0',
          engineRuleId: 'marlo/b5c3f8',
          actRuleId: 'b5c3f8',
          outcome: 'failed',
          target: { selector: 'html', snippet: '<html>', path: [] },
          message: 'no lang',
        },
      ],
      error: null,
      missingCapabilities: [],
      durationMs: 1,
    },
  ],
  notRequested: [],
  durationMs: 1,
};

describe('MarloEngine through a page', () => {
  it('asks the bundle for the requested rules with the page facts and returns its report', async () => {
    const page = fakePage({ ok: true, value: canned });
    const report = await new MarloEngine().evaluate(pageOf(page), ['b5c3f8']);
    expect(report).toEqual(canned);
    const call = page.evaluated.find((e) => e.includes('MarloRules.evaluate(')) ?? '';
    expect(call).toContain('["b5c3f8"]');
    expect(call).toContain('"url":"https://marlo.invalid/"');
    expect(call).toContain('"renderer":"browser"');
    expect(call).toContain('"capabilities":["dom","script","layout","paint"]');
    expect(call).toMatch(/"version":"\d+\.\d+\.\d+/);
  });

  it('validates what came back rather than trusting it', async () => {
    const page = fakePage({ ok: true, value: { engine: 'marlo', results: 'none' } });
    const report = await new MarloEngine().evaluate(pageOf(page), ['b5c3f8']);
    expect(report.results[0]?.status).toBe('error');
    expect(report.results[0]?.verdicts).toEqual([]);
  });

  it('reports what the page threw as an error on every requested rule', async () => {
    // A navigation inside the page destroys the context mid-evaluation. One page that
    // could not be measured is an error per rule, never a crash and never a pass.
    const page = fakePage({ ok: false, error: 'MarloRules is not defined' });
    const report = await new MarloEngine().evaluate(pageOf(page), ['b5c3f8', '23a2a8']);
    expect(report.results.map((r) => r.status)).toEqual(['error', 'error']);
    expect(report.results[0]?.error).toMatch(/inside the page: MarloRules is not defined/);
  });

  it('still refuses a handle that is neither a window nor a page', async () => {
    await expect(new MarloEngine().evaluate(pageOf({}), ['b5c3f8'])).rejects.toThrow(
      /handed neither/,
    );
  });

  it('finds its bundle next to its own package', () => {
    expect(marloBundlePath()).toBe(resolve(import.meta.dirname, '..', 'dist', 'marlo.browser.js'));
  });
});

/**
 * The bundle entry itself, run in this process against a happy-dom document standing in
 * for the page's globals. What it adds over the window path is the two hooks a laid-out
 * page supplies, so that is what is asserted: they are called, a layout rule is evaluated
 * rather than declined, and what comes back is a valid report and plain data.
 */
describe('the Marlo bundle entry', () => {
  const renderer = new StaticRenderer();
  afterEach(async () => {
    vi.unstubAllGlobals();
    await renderer.dispose();
  });

  const options = {
    url: 'https://marlo.invalid/',
    renderer: 'browser',
    capabilities: ['dom', 'script', 'layout', 'paint'],
    version: '0.1.0',
  } as const;

  it('reads styles and boxes off the live document and returns a plain report', async () => {
    const page = await renderer.render({
      html: '<!doctype html><html lang="en"><head><title>t</title></head><body><p style="color: #777777; background: #ffffff">Some text</p></body></html>',
    });
    const window = page.handle as {
      document: unknown;
      getComputedStyle(element: unknown): { getPropertyValue(property: string): string };
    };
    const styled: unknown[] = [];
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('getComputedStyle', (element: unknown) => {
      styled.push(element);
      return window.getComputedStyle(element);
    });
    vi.stubGlobal('scrollX', 0);
    vi.stubGlobal('scrollY', 0);

    const report = evaluate(['b5c3f8', 'afw4f7'], options);

    expect(EngineReport.parse(report)).toEqual(report);
    expect(structuredClone(report)).toEqual(report);
    expect(styled.length).toBeGreaterThan(0);
    const lang = report.results.find((r) => r.actRuleId === 'b5c3f8');
    expect(lang?.status).toBe('ok');
    const contrast = report.results.find((r) => r.actRuleId === 'afw4f7');
    expect(contrast?.status, 'a layout rule declined with layout supplied').toBe('ok');
    expect(contrast?.missingCapabilities).toEqual([]);
  });

  it('refuses a document with no root element', () => {
    vi.stubGlobal('document', { documentElement: null, doctype: null });
    expect(() => evaluate(['b5c3f8'], options)).toThrow(/no root/);
  });
});
