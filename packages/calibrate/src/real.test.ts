import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import type { ActRuleId, EngineId, Outcome, RoutingDecision } from '@trymarlo/schema';
import { CalibrationTable, RealCorpus as RealCorpusSchema } from '@trymarlo/schema';
import type { Engine } from '@trymarlo/engines';
import { StaticRenderer } from '@trymarlo/render';
import { IMPLEMENTED_RULES } from '@trymarlo/rules';

import type { Adjudication, RealCorpusSource, RealPage, SheetCell } from './real-corpus.js';
import { cellKey, loadAdjudication, loadRealCorpus, pageLabel } from './real-corpus.js';
import { cohensKappa, runRealHarness, summariseAdjudication } from './real-harness.js';
import type { PageEvaluation } from './real-pool.js';
import { evaluatePage, mapLimit, runWorker } from './real-pool.js';
import { findRealCorpusChanges, renderCalibrationMarkdown } from './publish.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

const times = <T>(n: number, pair: T): T[] => Array.from({ length: n }, () => pair);

describe("Cohen's kappa, as the harness computes it", () => {
  it('matches the same hand-computed table the adjudication script is tested against', () => {
    // po = 0.70, pe = 0.5 * 0.6 + 0.5 * 0.4 = 0.50, kappa = 0.40.
    const { percentAgreement, kappa } = cohensKappa([
      ...times(20, ['yes', 'yes'] as const),
      ...times(5, ['yes', 'no'] as const),
      ...times(10, ['no', 'yes'] as const),
      ...times(15, ['no', 'no'] as const),
    ]);
    expect(percentAgreement).toBeCloseTo(0.7, 12);
    expect(kappa).toBeCloseTo(0.4, 12);
  });

  it('is undefined rather than invented in the degenerate cases', () => {
    expect(cohensKappa([])).toEqual({ percentAgreement: null, kappa: null });
    expect(cohensKappa(times(5, ['failed', 'failed'] as const))).toEqual({
      percentAgreement: 1,
      kappa: null,
    });
    expect(
      cohensKappa([
        ...times(2, ['passed', 'passed'] as const),
        ...times(2, ['passed', 'failed'] as const),
      ]).kappa,
    ).toBe(0);
  });
});

describe('the real corpus on disk', () => {
  it('loads every page and names each by category and digest, never by URL', () => {
    const corpus = loadRealCorpus(ROOT);
    expect(corpus.pages.length).toBeGreaterThan(20);
    expect(Object.values(corpus.categories).reduce((a, b) => a + b, 0)).toBe(corpus.pages.length);
    for (const page of corpus.pages) {
      expect(page.label).toMatch(/^[a-z]+ \([0-9a-f]{12}\)$/);
      expect(page.label).not.toContain('http');
    }
    const first = corpus.pages[0];
    expect(first === undefined ? '' : corpus.read(first)).toMatch(/^<!DOCTYPE/i);
  });

  it('has worksheets that cover every page and every implemented rule, with every rater named', () => {
    const corpus = loadRealCorpus(ROOT);
    const adjudication = loadAdjudication(ROOT);
    for (const sheet of [adjudication.sheetA, adjudication.sheetB]) {
      expect(sheet).toHaveLength(corpus.pages.length * IMPLEMENTED_RULES.length);
    }
    const summary = summariseAdjudication(adjudication, corpus.pages, IMPLEMENTED_RULES);
    // Whatever stage the adjudication is at, a rated cell has a named rater behind it.
    expect(summary.ratedCells === 0 || summary.raters.length === 2).toBe(true);
    expect(summary.resolvedCells).toBeLessThanOrEqual(summary.totalCells);
  });

  it('refuses a malformed manifest or worksheet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'marlo-real-'));
    mkdirSync(join(dir, 'corpus/real/adjudication'), { recursive: true });
    writeFileSync(join(dir, 'corpus/real/MANIFEST.json'), JSON.stringify({ pages: [] }));
    expect(() => loadRealCorpus(dir)).toThrow(/not a valid manifest/);
    writeFileSync(
      join(dir, 'corpus/real/MANIFEST.json'),
      JSON.stringify({
        retrieved: '2026-10-12',
        totals: { pages: 2, categories: { shop: 1 } },
        pages: [
          {
            id: 'shop-01',
            category: 'shop',
            url: 'https://example.com/',
            retrieved: '2026-10-12',
            path: 'pages/shop-01/index.html',
            sha256: 'a'.repeat(64),
            bytes: 10,
          },
        ],
      }),
    );
    expect(() => loadRealCorpus(dir)).toThrow(/claims 2 pages and lists 1/);
    expect(loadAdjudication(dir)).toEqual({
      sheetA: [],
      sheetB: [],
      resolved: new Map(),
      raters: [],
      resolutions: { person: 0, model: 0 },
    });
    writeFileSync(
      join(dir, 'corpus/real/adjudication/sheet-A.json'),
      JSON.stringify({ rater: 'Q' }),
    );
    expect(() => loadAdjudication(dir)).toThrow(/sheet-A.json is not valid/);
  });
});

describe('a real page is evaluated under a hard time cap', () => {
  const spawn = (code: string) => () => new Worker(code, { eval: true });

  it('returns what the worker reports', async () => {
    const reply = {
      results: [{ actRuleId: 'b5c3f8', status: 'ok', outcome: 'failed', findings: 1 }],
    };
    const evaluation = await runWorker(
      spawn(`require('node:worker_threads').parentPort.postMessage(${JSON.stringify(reply)})`),
      10_000,
    );
    expect(evaluation).toEqual({ ...reply, errored: null });
  });

  it('records a worker that never finishes as errored, not as a pass', async () => {
    const evaluation = await runWorker(spawn('setInterval(() => {}, 1000); while (true) {}'), 300);
    expect(evaluation.results).toEqual([]);
    expect(evaluation.errored).toMatch(/timed out after 300 ms/);
  });

  it('records a crash, a silent exit and a malformed reply as errored', async () => {
    const crashed = await runWorker(spawn("throw new Error('boom')"), 10_000);
    expect(crashed.errored).toMatch(/boom/);
    const silent = await runWorker(spawn(''), 10_000);
    expect(silent.errored).toMatch(/exited with code 0 and no result/);
    const malformed = await runWorker(
      spawn("require('node:worker_threads').parentPort.postMessage({ results: 'all clean' })"),
      10_000,
    );
    expect(malformed.errored).toMatch(/not a result/);
  });

  it('keeps order and bounds concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });

  it('collapses verdicts exactly as the ACT pass does, and errors an omitted rule', async () => {
    const stub: Engine = {
      id: 'axe-core',
      version: '0',
      requires: ['dom'],
      mapping: {} as Engine['mapping'],
      evaluate: async () =>
        Promise.resolve({
          engine: 'axe-core',
          engineVersion: '0',
          renderer: 'static',
          durationMs: 0,
          results: [
            {
              actRuleId: 'b5c3f8',
              engine: 'axe-core',
              status: 'ok',
              verdicts: [
                { engineRuleId: 'x', outcome: 'passed', selector: 'a', snippet: '', message: '' },
                { engineRuleId: 'x', outcome: 'failed', selector: 'b', snippet: '', message: '' },
                { engineRuleId: 'x', outcome: 'failed', selector: 'c', snippet: '', message: '' },
              ],
            },
            { actRuleId: '2779a5', engine: 'axe-core', status: 'unsupported', verdicts: [] },
          ],
        } as unknown as Awaited<ReturnType<Engine['evaluate']>>),
    };
    const renderer = new StaticRenderer();
    const evaluation = await evaluatePage(
      stub,
      renderer,
      { html: '<html><title>t</title></html>', url: 'https://example.com/' },
      ['b5c3f8', '2779a5', 'cae760'],
    );
    await renderer.dispose();
    expect(evaluation.results).toEqual([
      { actRuleId: 'b5c3f8', status: 'ok', outcome: 'failed', findings: 2 },
      { actRuleId: '2779a5', status: 'unsupported', outcome: null, findings: 0 },
      { actRuleId: 'cae760', status: 'error', outcome: null, findings: 0 },
    ]);
  });
});

describe('the real-page pass', () => {
  const page = (id: string, category: string, digit: string): RealPage => {
    const sha256 = digit.repeat(64);
    return {
      id,
      category,
      url: `https://example.com/${id}`,
      retrieved: '2026-10-12',
      path: `pages/${id}/index.html`,
      sha256,
      bytes: 10,
      label: pageLabel({ category, sha256 }),
    };
  };
  const pages = [
    page('shop-01', 'shop', 'a'),
    page('news-01', 'news', 'b'),
    page('form-01', 'form', 'c'),
  ];
  const corpus: RealCorpusSource = {
    retrieved: '2026-10-12',
    pages,
    categories: { shop: 1, news: 1, form: 1 },
    read: () => '',
  };
  const rule: ActRuleId = '97a4e1';
  const engines: { id: EngineId; claimedRules: ReadonlySet<ActRuleId> }[] = [
    { id: 'marlo', claimedRules: new Set([rule]) },
    { id: 'axe-core', claimedRules: new Set([rule]) },
    { id: 'htmlcs', claimedRules: new Set<ActRuleId>() },
  ];
  /** What each engine says on each page. `error` is a crashed evaluation. */
  const said: Record<string, Partial<Record<EngineId, Outcome | 'error'>>> = {
    'shop-01': { marlo: 'failed', 'axe-core': 'failed' },
    'news-01': { marlo: 'passed', 'axe-core': 'failed' },
    'form-01': { marlo: 'error', 'axe-core': 'passed' },
  };
  const evaluate = (
    p: RealPage,
    engine: EngineId,
    rules: readonly ActRuleId[],
  ): Promise<PageEvaluation> => {
    const outcome = said[p.id]?.[engine];
    if (outcome === 'error')
      return Promise.resolve({ results: [], errored: 'timed out after 1 ms' });
    if (engine === 'htmlcs' && p.id === 'news-01') {
      // An engine that reports a rule as errored, as HTML CodeSniffer does on some real
      // pages, has not looked at that page: the page is errored, not clean.
      return Promise.resolve({
        errored: null,
        results: [{ actRuleId: rule, status: 'error' as const, outcome: null, findings: 0 }],
      });
    }
    return Promise.resolve({
      errored: null,
      results: rules.map((actRuleId) => ({
        actRuleId,
        status: 'ok' as const,
        outcome: outcome ?? 'inapplicable',
        findings: outcome === 'failed' ? 2 : 0,
      })),
    });
  };
  const routing: RoutingDecision[] = [
    {
      actRuleId: rule,
      chosen: 'marlo',
      reason: 'best-measured',
      candidates: [],
      autoFixPermitted: false,
    },
  ];
  const unrated = { raters: [], resolutions: { person: 0, model: 0 } };
  const models = {
    raters: [
      { rater: 'A' as const, kind: 'model' as const, model: 'claude-opus-5-5' },
      { rater: 'B' as const, kind: 'model' as const, model: 'claude-sonnet-5-5' },
    ],
    resolutions: { person: 0, model: 0 },
  };
  const empty: Adjudication = { sheetA: [], sheetB: [], resolved: new Map(), ...unrated };

  it('publishes ground-truth-free figures, and no accuracy, before anyone has rated', async () => {
    const { block, errors } = await runRealHarness({
      corpus,
      adjudication: empty,
      engines,
      implementedRules: [rule],
      routing,
      evaluate,
      concurrency: 2,
    });
    expect(RealCorpusSchema.safeParse(block).success).toBe(true);
    expect(errors).toEqual([
      { page: 'form (cccccccccccc)', engine: 'marlo', reason: 'timed out after 1 ms' },
    ]);

    const marlo = block.entries.find((e) => e.engine === 'marlo');
    expect(marlo?.outcomes).toEqual({ passed: 1, failed: 1, cantTell: 0, inapplicable: 0 });
    // The timed-out page is errored, never folded into passed.
    expect(marlo?.errored).toBe(1);
    expect(marlo?.findings).toBe(2);
    expect(marlo?.graded).toEqual({
      resolvedCells: 0,
      unresolvedCells: 3,
      cantTellTruth: 0,
      strict: null,
    });
    // htmlcs claims nothing, so it has no entry rather than a row of zeros.
    expect(block.entries.map((e) => e.engine)).toEqual(['marlo', 'axe-core']);

    // Two pages where both answered: one agreement, one disagreement.
    expect(block.agreement).toEqual([
      {
        actRuleId: rule,
        engines: ['marlo', 'axe-core'],
        pages: 2,
        percentAgreement: 0.5,
        kappa: 0,
      },
    ]);

    // The routed engine said passed on news-01 while a peer said failed: the invariant
    // fires. On form-01 the routed engine errored and the peer passed: it does not.
    expect(block.aggregate.invariant).toEqual({
      pages: 3,
      pagesWhereItWouldFire: 1,
      fraction: 0.3333,
      perRule: [{ actRuleId: rule, routedTo: 'marlo', pagesWhereItWouldFire: 1 }],
    });

    expect(block.aggregate.findingsPerPage).toEqual([
      { engine: 'marlo', pages: 2, findings: 2, mean: 1 },
      { engine: 'axe-core', pages: 3, findings: 4, mean: 1.3333 },
      { engine: 'htmlcs', pages: 2, findings: 0, mean: 0 },
    ]);
    expect(block.aggregate.perPage[2]).toEqual({
      page: 'form (cccccccccccc)',
      findings: { marlo: null, 'axe-core': 0, htmlcs: 0 },
    });
    expect(block.adjudication.status).toBe('awaiting-adjudication');
    expect(block.aggregate.accuracy).toEqual({
      strictPrecision: null,
      strictRecall: null,
      falsePositiveRate: null,
      sampleSize: 0,
    });
  });

  it('grades only resolved cells, counts the rest, and never scores a cantTell truth', async () => {
    const resolved = new Map<string, Outcome>([
      [cellKey('shop-01', rule), 'failed'],
      [cellKey('news-01', rule), 'cantTell'],
    ]);
    const sheet: SheetCell[] = pages.map((p) => ({
      page: p.id,
      rule,
      answer: 'failed',
      prescreened: false,
    }));
    const { block } = await runRealHarness({
      corpus,
      adjudication: { sheetA: sheet, sheetB: sheet, resolved, ...models },
      engines,
      implementedRules: [rule],
      routing,
      evaluate,
      concurrency: 1,
    });
    expect(RealCorpusSchema.safeParse(block).success).toBe(true);
    const marlo = block.entries.find((e) => e.engine === 'marlo');
    expect(marlo?.graded.resolvedCells).toBe(2);
    expect(marlo?.graded.unresolvedCells).toBe(1);
    expect(marlo?.graded.cantTellTruth).toBe(1);
    expect(marlo?.graded.strict?.truePositives).toBe(1);
    expect(block.adjudication).toEqual({
      status: 'partial',
      ratedCells: 3,
      resolvedCells: 2,
      totalCells: 3,
      kappa: null,
      percentAgreement: 1,
      raters: models.raters,
      resolutions: { person: 0, model: 0 },
    });
    expect(block.aggregate.accuracy.strictPrecision).toBe(1);
    expect(block.aggregate.accuracy.sampleSize).toBe(1);
  });

  it('leaves pre-screened cells both raters left alone out of the agreement figure', () => {
    const left: SheetCell[] = [
      { page: 'shop-01', rule, answer: 'inapplicable', prescreened: true },
      { page: 'news-01', rule, answer: 'passed', prescreened: false },
    ];
    const right: SheetCell[] = [
      { page: 'shop-01', rule, answer: 'inapplicable', prescreened: true },
      { page: 'news-01', rule, answer: 'failed', prescreened: false },
    ];
    const summary = summariseAdjudication(
      { sheetA: left, sheetB: right, resolved: new Map(), ...models },
      pages,
      [rule],
    );
    expect(summary.ratedCells).toBe(1);
    expect(summary.percentAgreement).toBe(0);
    expect(summary.status).toBe('partial');
  });

  it('publishes its own section, says no accuracy figure exists, and fails --check on any movement', async () => {
    const act = CalibrationTable.parse(
      JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
    );
    const { block } = await runRealHarness({
      corpus,
      adjudication: empty,
      engines,
      implementedRules: [rule],
      routing,
      evaluate,
      concurrency: 2,
    });
    const before = CalibrationTable.parse({ ...act, realCorpus: block });
    const markdown = renderCalibrationMarkdown(before);
    expect(markdown).toMatch(/## Real pages/);
    expect(markdown).toMatch(/0 of 3 cells/);
    expect(markdown).toMatch(/No accuracy figure exists for these pages yet/);
    expect(markdown).not.toMatch(/## Held-out real pages/);
    expect(markdown).not.toMatch(/Every engine on the resolved cells/);
    expect(markdown).toMatch(/On 1 of 3 pages \(33\.3%\)/);
    expect(markdown).toMatch(/\| `97a4e1` \| Marlo and axe-core \| 2 \| 50\.0% \| 0\.00 \|/);
    expect(markdown).not.toContain('https://example.com');
    expect(markdown).not.toMatch(/\u2014/);

    // Nothing moved: nothing to report.
    expect(findRealCorpusChanges(before, before)).toEqual([]);
    // A figure that moved in the flattering direction fails exactly as one that got worse.
    const moved = CalibrationTable.parse({
      ...before,
      realCorpus: {
        ...block,
        aggregate: {
          ...block.aggregate,
          invariant: { ...block.aggregate.invariant, pagesWhereItWouldFire: 0, fraction: 0 },
        },
      },
    });
    expect(findRealCorpusChanges(before, moved)).toEqual([
      'realCorpus.aggregate.invariant.fraction: 0.3333 -> 0',
      'realCorpus.aggregate.invariant.pagesWhereItWouldFire: 1 -> 0',
    ]);
    // A table regenerated without the block is a change too.
    expect(findRealCorpusChanges(before, act).length).toBeGreaterThan(0);
    expect(findRealCorpusChanges(act, before, 3)).toHaveLength(4);

    // Once cells are resolved the accuracy table appears in place of the refusal.
    const resolved = await runRealHarness({
      corpus,
      adjudication: {
        sheetA: pages.map((p) => ({
          page: p.id,
          rule,
          answer: 'failed',
          prescreened: false,
        })),
        sheetB: pages.map((p) => ({
          page: p.id,
          rule,
          answer: 'failed',
          prescreened: false,
        })),
        resolved: new Map<string, Outcome>([[cellKey('shop-01', rule), 'failed']]),
        ...models,
      },
      engines,
      implementedRules: [rule],
      routing: [{ ...routing[0], chosen: null, reason: 'uncalibrated' } as RoutingDecision],
      evaluate,
      concurrency: 2,
    });
    const graded = renderCalibrationMarkdown(
      CalibrationTable.parse({ ...act, realCorpus: resolved.block }),
    );
    expect(graded).toMatch(/Marlo against the resolved cells only/);
    expect(graded).toMatch(/Cohen's kappa undefined/);
    expect(graded).toMatch(/\| `97a4e1` \| nobody \| 2 \|/);

    // Every engine is pooled the same way, with the counts behind each rate.
    const pooled = resolved.block.aggregate.engines ?? [];
    expect(pooled.map((row) => row.engine)).toEqual(['axe-core', 'marlo']);
    for (const row of pooled) {
      expect(row.rules).toBe(1);
      expect(row.sampleSize).toBe(
        row.truePositives + row.falsePositives + row.falseNegatives + row.trueNegatives,
      );
    }
    expect(graded).toMatch(/### Every engine on the resolved cells/);
    expect(graded).toMatch(/\| Marlo \| 1 \| \d+ \| \d+ \| \d+ \| /);
    expect(block.aggregate.engines).toEqual([]);

    // The held-out corpus gets its own section and its own change detection, and is
    // never folded into the real-page block.
    const both = CalibrationTable.parse({
      ...act,
      realCorpus: block,
      heldOutCorpus: resolved.block,
    });
    const twoSections = renderCalibrationMarkdown(both);
    expect(twoSections).toMatch(/## Real pages[\s\S]*## Held-out real pages/);
    expect(twoSections).toMatch(/out-of-sample/);
    expect(twoSections).toMatch(/corpus\/heldout\/NOTICE\.md/);
    expect(findRealCorpusChanges(both, both)).toEqual([]);
    const withoutHeldOut = CalibrationTable.parse({ ...act, realCorpus: block });
    const dropped = findRealCorpusChanges(both, withoutHeldOut, 10_000);
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.every((change) => change.startsWith('heldOutCorpus'))).toBe(true);
  });
});
