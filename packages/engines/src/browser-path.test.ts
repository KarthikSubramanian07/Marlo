import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RenderedPage } from '@trymarlo/render';
import { StaticRenderer, withDomGlobals } from '@trymarlo/render';

import {
  AlfaEngine,
  AxeEngine,
  HtmlcsEngine,
  asBrowserPage,
  asWindow,
  bundlePath,
  describeSelector,
  describeSelectorSource,
  ensureScript,
  evaluateInPage,
  inPageExpression,
  isBrowserPage,
  isWindow,
  narrowHandle,
  readBundle,
  unwrapInPageResult,
} from './index.js';
import type { BrowserPageLike } from './dom.js';
import { alfaBundlePath, narrowOutcomeRecords } from './alfa/adapter.js';
import { narrowRecords } from './htmlcs/adapter.js';

/**
 * The browser path, exercised without a browser.
 *
 * A Playwright page is two functions as far as the adapters are concerned, `evaluate` and
 * `addScriptTag`, so a fake page is a small object and the whole path short of Chromium
 * itself can be driven from the unit project: which path a handle selects, what is
 * injected, what is asked of the page, and how a payload or a failure that comes back is
 * translated. The real browser is covered by tests/e2e/browser.browser.test.ts.
 */

/**
 * A fake page. `evaluate` answers the global-presence probe with `installed`, and every
 * other expression with the envelope under `result`. Everything asked of it is recorded.
 */
function fakePage(options: {
  readonly result: unknown;
  readonly installed?: boolean;
}): BrowserPageLike & { readonly injected: string[]; readonly evaluated: string[] } {
  const injected: string[] = [];
  const evaluated: string[] = [];
  return {
    injected,
    evaluated,
    evaluate(expression: string): Promise<unknown> {
      evaluated.push(expression);
      if (expression.startsWith('typeof globalThis[')) {
        return Promise.resolve(options.installed === true ? 'object' : 'undefined');
      }
      return Promise.resolve(options.result);
    },
    addScriptTag({ content }: { readonly content: string }): Promise<unknown> {
      injected.push(content);
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

const ok = (value: unknown) => ({ ok: true, value });

describe('narrowing a handle to one of the two shapes', () => {
  const window = { document: {}, eval: () => undefined };
  const page = { evaluate: () => Promise.resolve(), addScriptTag: () => Promise.resolve() };

  it('tells a window from a page and refuses anything else', () => {
    expect(isWindow(window)).toBe(true);
    expect(isWindow(page)).toBe(false);
    expect(isBrowserPage(page)).toBe(true);
    expect(isBrowserPage(window)).toBe(false);
    expect(narrowHandle(window, 'x').kind).toBe('window');
    expect(narrowHandle(page, 'x').kind).toBe('page');
    expect(() => narrowHandle({}, 'axe-core')).toThrow(/handed neither/);
    expect(() => narrowHandle(null, 'axe-core')).toThrow(TypeError);
  });

  it('keeps the loud single-shape guards', () => {
    expect(asWindow(window, 'x')).toBe(window);
    expect(() => asWindow(page, 'alfa')).toThrow(/needs a DOM window/);
    expect(asBrowserPage(page, 'x')).toBe(page);
    expect(() => asBrowserPage(window, 'alfa')).toThrow(/needs a browser page/);
  });
});

describe('the serialisation boundary', () => {
  it('wraps a body so that a value comes back in an envelope', async () => {
    const expression = inPageExpression('return 1 + 1;');
    // The expression is plain JavaScript, so it can be evaluated here too.
    const result: unknown = await (0, eval)(expression);
    expect(result).toEqual({ ok: true, value: 2 });
    expect(unwrapInPageResult(result)).toBe(2);
  });

  it('wraps a body so that a throw comes back as data, and reopens as a throw', async () => {
    const result: unknown = await (0, eval)(inPageExpression('throw new Error("no HTMLCS");'));
    expect(result).toEqual({ ok: false, error: 'no HTMLCS' });
    expect(() => unwrapInPageResult(result)).toThrow(/inside the page: no HTMLCS/);
  });

  it('carries a non-Error throw as its string form', async () => {
    const result: unknown = await (0, eval)(inPageExpression('throw "plain";'));
    expect(result).toEqual({ ok: false, error: 'plain' });
  });

  it('refuses anything that is not an envelope', () => {
    // A bundle from another revision returning its payload bare must not be read as a
    // payload with every field missing.
    expect(() => unwrapInPageResult([])).toThrow(/other than an in-page result envelope/);
    expect(() => unwrapInPageResult(null)).toThrow(TypeError);
    expect(() => unwrapInPageResult({ ok: 'yes' })).toThrow(TypeError);
    expect(() => unwrapInPageResult({ ok: false })).toThrow(/no message/);
  });

  it('evaluates through a page and unwraps in one step', async () => {
    const page = fakePage({ result: ok({ answer: 42 }) });
    await expect(evaluateInPage(page, 'return 1;')).resolves.toEqual({ answer: 42 });
    expect(page.evaluated[0]).toContain('return 1;');
  });
});

describe('injecting a script once', () => {
  it('reads and injects the source only when the global is absent', async () => {
    const absent = fakePage({ result: ok(null) });
    let reads = 0;
    await ensureScript(absent, 'axe', () => {
      reads += 1;
      return 'var axe = 1;';
    });
    expect(reads).toBe(1);
    expect(absent.injected).toEqual(['var axe = 1;']);
    expect(absent.evaluated[0]).toBe('typeof globalThis["axe"]');

    const present = fakePage({ result: ok(null), installed: true });
    await ensureScript(present, 'axe', () => {
      reads += 1;
      return 'var axe = 1;';
    });
    // Not read a second time: a two megabyte bundle is not re-read for a page that has it.
    expect(reads).toBe(1);
    expect(present.injected).toEqual([]);
  });
});

describe('the selector convention travels into the page as source', () => {
  it('is the same function on both sides', () => {
    const inPage = (0, eval)(describeSelectorSource()) as typeof describeSelector;
    const el = (tag: string, attrs: Record<string, string>) => ({
      tagName: tag,
      outerHTML: '',
      getAttribute: (n: string) => attrs[n] ?? null,
    });
    for (const element of [
      el('P', { id: 'intro' }),
      el('DIV', { class: ' card wide ' }),
      el('SPAN', {}),
      el('A', { id: '', class: 'x' }),
    ]) {
      expect(inPage(element)).toBe(describeSelector(element));
    }
  });
});

describe('finding a bundle', () => {
  it('walks from a package.json into dist, from src and from dist alike', () => {
    expect(bundlePath('/repo/packages/engines/package.json', 'alfa.browser.js')).toBe(
      resolve('/repo/packages/engines/dist/alfa.browser.js'),
    );
    expect(alfaBundlePath()).toBe(resolve(import.meta.dirname, '..', 'dist', 'alfa.browser.js'));
  });

  it('names pnpm build when the bundle is missing', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'marlo-bundle-')), 'nothing.js');
    expect(() => readBundle(missing, 'Alfa')).toThrow(/Alfa browser bundle is missing/);
    expect(() => readBundle(missing, 'Alfa')).toThrow(/pnpm build/);
  });

  it('reads a bundle that is there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'marlo-bundle-'));
    writeFileSync(join(dir, 'x.js'), 'var x;', 'utf8');
    expect(readBundle(join(dir, 'x.js'), 'x')).toBe('var x;');
  });
});

describe('axe-core through a page', () => {
  const run = {
    violations: [
      {
        id: 'html-has-lang',
        help: '<html> element must have a lang attribute',
        description: '',
        nodes: [{ target: ['html'], html: '<html>', failureSummary: 'Fix: add lang' }],
      },
    ],
    passes: [],
    incomplete: [],
    inapplicable: [],
  };

  it('injects axe, runs it, and translates the result exactly as the window path does', async () => {
    const page = fakePage({ result: ok(run) });
    const report = await new AxeEngine().evaluate(pageOf(page), ['b5c3f8']);
    expect(page.injected[0]).toContain('axe');
    expect(page.evaluated.some((e) => e.includes('axe.run(document'))).toBe(true);
    const result = report.results.find((r) => r.actRuleId === 'b5c3f8');
    expect(result?.status).toBe('ok');
    expect(result?.verdicts.map((v) => [v.outcome, v.target.selector, v.target.snippet])).toEqual([
      ['failed', 'html', '<html>'],
    ]);
    expect(result?.verdicts[0]?.message).toBe('Fix: add lang');
    expect(report.renderer).toBe('browser');
  });

  it('reports every requested rule as errored when the page throws', async () => {
    const page = fakePage({ result: { ok: false, error: 'axe is not defined' } });
    const report = await new AxeEngine().evaluate(pageOf(page), ['b5c3f8', '23a2a8']);
    for (const result of report.results) {
      expect(result.status).toBe('error');
      expect(result.error).toContain('inside the page: axe is not defined');
      expect(result.verdicts).toEqual([]);
    }
  });

  it('refuses a payload that is not an axe run', async () => {
    const page = fakePage({ result: ok({ violations: [] }) });
    const report = await new AxeEngine().evaluate(pageOf(page), ['b5c3f8']);
    expect(report.results[0]?.status).toBe('error');
    expect(report.results[0]?.error).toContain('no passes array');
  });
});

describe('HTML CodeSniffer through a page', () => {
  it('reads the selector and snippet the page already took off the node', async () => {
    const page = fakePage({
      result: ok([
        {
          type: 1,
          code: 'WCAG2AA.Principle3.Guideline3_1.3_1_1.H57.2',
          msg: 'The html element should have a lang attribute.',
          snippet: '<html><head></head><body></body></html>',
          selector: 'html',
        },
      ]),
    });
    const report = await new HtmlcsEngine().evaluate(pageOf(page), ['b5c3f8']);
    expect(page.injected[0]).toContain('HTML_CodeSniffer');
    const script = page.evaluated.find((e) => e.includes('HTMLCS.process')) ?? '';
    // The convention is carried as source, so the page script contains the function.
    expect(script).toContain('getAttribute');
    const result = report.results.find((r) => r.actRuleId === 'b5c3f8');
    expect(result?.status).toBe('ok');
    expect(result?.verdicts).toHaveLength(1);
    expect(result?.verdicts[0]?.outcome).toBe('failed');
    expect(result?.verdicts[0]?.target.selector).toBe('html');
    expect(result?.verdicts[0]?.target.snippet).toContain('<html>');
    expect(result?.verdicts[0]?.engineRuleId).toBe('3_1_1.H57.2');
  });

  it('still reads silence as a pass on the browser path', async () => {
    const page = fakePage({ result: ok([]) });
    const report = await new HtmlcsEngine().evaluate(pageOf(page), ['b5c3f8']);
    const result = report.results.find((r) => r.actRuleId === 'b5c3f8');
    expect(result?.status).toBe('ok');
    expect(result?.verdicts[0]?.outcome).toBe('passed');
    expect(result?.verdicts[0]?.message).toContain('silence is read as a pass');
  });

  it('narrows records field by field', () => {
    expect(() => narrowRecords({})).toThrow(/message list/);
    expect(() => narrowRecords([1])).toThrow(/not an object/);
    expect(() => narrowRecords([{ type: 'Error', code: 'x', msg: 'y' }])).toThrow(/missing/);
    expect(narrowRecords([{ type: 2, code: 'c', msg: 'm' }])).toEqual([
      { type: 2, code: 'c', msg: 'm', snippet: '', selector: ':root' },
    ]);
    expect(narrowRecords([{ type: 2, code: 'c', msg: 'm', snippet: 's', selector: '' }])).toEqual([
      { type: 2, code: 'c', msg: 'm', snippet: 's', selector: ':root' },
    ]);
  });

  it('reports every claimed rule as errored when the page throws', async () => {
    const page = fakePage({ result: { ok: false, error: 'HTMLCS.process is not a function' } });
    const report = await new HtmlcsEngine().evaluate(pageOf(page), ['b5c3f8']);
    expect(report.results[0]?.status).toBe('error');
    expect(report.results[0]?.error).toContain('HTMLCS.process');
  });
});

describe('Alfa through a page', () => {
  it('asks the bundle to audit the page URL and translates the records', async () => {
    // `installed` so the fake page claims MarloAlfa is present and no bundle is read: the
    // unit suite runs on checkouts that have never been built.
    const page = fakePage({
      installed: true,
      result: ok([
        {
          outcome: 'failed',
          ruleUri: 'https://alfa.siteimprove.com/rules/sia-r4',
          selector: 'xpath /html[1]',
          snippet: '<html></html>',
          message: 'The document has no lang attribute',
        },
        {
          outcome: 'passed',
          ruleUri: 'https://alfa.siteimprove.com/rules/sia-r999',
          selector: ':root',
          snippet: '',
          message: null,
        },
      ]),
    });
    const report = await new AlfaEngine().evaluate(pageOf(page), ['b5c3f8']);
    expect(page.injected).toEqual([]);
    expect(
      page.evaluated.some((e) => e.includes('MarloAlfa.audit("https://marlo.invalid/")')),
    ).toBe(true);
    const result = report.results.find((r) => r.actRuleId === 'b5c3f8');
    expect(result?.status).toBe('ok');
    expect(result?.verdicts).toEqual([
      expect.objectContaining({
        engineRuleId: 'sia-r4',
        outcome: 'failed',
        target: { selector: 'xpath /html[1]', snippet: '<html></html>', path: [] },
        message: 'The document has no lang attribute',
      }),
    ]);
  });

  it('costs only the rules an unknown outcome word speaks for', async () => {
    const page = fakePage({
      installed: true,
      result: ok([
        { outcome: 'maybe', ruleUri: 'https://alfa.siteimprove.com/rules/sia-r4' },
        {
          outcome: 'failed',
          ruleUri: 'https://alfa.siteimprove.com/rules/sia-r2',
          selector: 'xpath /html[1]/body[1]/img[1]',
          snippet: '<img src="a.png">',
          message: null,
        },
      ]),
    });
    const report = await new AlfaEngine().evaluate(pageOf(page), ['b5c3f8', '23a2a8']);
    expect(report.results.find((r) => r.actRuleId === 'b5c3f8')?.status).toBe('error');
    const img = report.results.find((r) => r.actRuleId === '23a2a8');
    expect(img?.status).toBe('ok');
    expect(img?.verdicts[0]?.message).toBe('Alfa sia-r2');
  });

  it('narrows records and refuses a payload with no rule URI', () => {
    expect(() => narrowOutcomeRecords({})).toThrow(/did not return a list/);
    expect(() => narrowOutcomeRecords([null])).toThrow(/not an object/);
    expect(() => narrowOutcomeRecords([{ outcome: 'passed' }])).toThrow(/no rule URI/);
    expect(narrowOutcomeRecords([{ outcome: 'passed', ruleUri: 'u' }])).toEqual([
      { outcome: 'passed', ruleUri: 'u', selector: ':root', snippet: '', message: null },
    ]);
  });

  it('reports the missing bundle by name when the page has no MarloAlfa', async () => {
    // Not installed, so the adapter goes to read the bundle. On a built tree that works
    // and the fake page swallows the injection; on an unbuilt one the error names the
    // build. Either way nothing is reported as a pass.
    const page = fakePage({ result: { ok: false, error: 'MarloAlfa is not defined' } });
    const report = await new AlfaEngine().evaluate(pageOf(page), ['b5c3f8']);
    expect(report.results[0]?.status).toBe('error');
    expect(report.results[0]?.error).toMatch(/MarloAlfa is not defined|pnpm build/);
  });
});

/**
 * The Alfa bundle entry, run in this process with a happy-dom document installed as the
 * global one, which is all a browser page is from Alfa's point of view. The records it
 * returns are what crosses the boundary, so they are checked for surviving a structured
 * clone and the adapter's own narrowing unchanged.
 */
describe('the Alfa bundle entry', () => {
  it('audits the global document into plain records carrying a target', async () => {
    const renderer = new StaticRenderer();
    try {
      const page = await renderer.render({
        html: '<!doctype html><html lang="en"><head><title>t</title></head><body><img src="a.png"></body></html>',
      });
      const records = await withDomGlobals(page.handle, async () => {
        // Imported inside the globals scope, because Alfa reads DOM globals at import.
        const { audit } = await import('./alfa/browser-entry.js');
        return audit(page.url);
      });
      expect(structuredClone(records)).toEqual(records);
      expect(narrowOutcomeRecords(records)).toEqual(records);
      const img = records.find((r) => r.ruleUri.endsWith('/sia-r2') && r.outcome === 'failed');
      expect(img?.selector).toBe('xpath /html[1]/body[1]/img[1]');
      expect(img?.snippet).toContain('<img');
    } finally {
      await renderer.dispose();
    }
  }, 60_000);

  it('refuses a realm with no document', async () => {
    const { audit } = await import('./alfa/browser-entry.js');
    await expect(audit('https://marlo.invalid/')).rejects.toThrow(/has none/);
  });
});
