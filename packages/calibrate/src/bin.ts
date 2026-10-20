#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { RendererId } from '@trymarlo/schema';
import { AnalysisReport, CalibrationTable } from '@trymarlo/schema';
import type { Renderer } from '@trymarlo/render';
import { BrowserRenderer, PlaywrightMissingError, StaticRenderer } from '@trymarlo/render';
import type { Engine } from '@trymarlo/engines';
import { peerEngines } from '@trymarlo/engines';
import { IMPLEMENTED_RULES } from '@trymarlo/rules';
import { analyse, collectCases, type RealPageCell } from './analysis.js';
import { loadCorpus } from './corpus.js';
import { MarloEngine } from './marlo-engine.js';
import { runHarness } from './harness.js';
import {
  findRealCorpusChanges,
  findRegressions,
  renderAnalysisMarkdown,
  renderCalibrationMarkdown,
} from './publish.js';
import { loadAdjudication, loadRealCorpus, type RealCorpusName } from './real-corpus.js';
import { runRealHarness } from './real-harness.js';
import { runWorker, type WorkerJob } from './real-pool.js';

/**
 * Regenerates the calibration table.
 *
 *   pnpm calibrate                      write calibration/table.json and README.md
 *   pnpm calibrate --check              regenerate in memory and fail on a regression
 *   pnpm calibrate --rule <actId>       measure one rule, for developing a mapping
 *   pnpm calibrate --renderer browser   measure under Chromium instead, writing
 *                                       calibration/browser.json and BROWSER.md
 *
 * `--check` is the CI gate. It is a required status, because a false positive rate that
 * can drift without failing a build is a marketing number.
 *
 * The static run measures every corpus: the ACT test cases first, then the real pages in
 * corpus/real, then the held-out pages in corpus/heldout, each graded separately and
 * written to its own block of the table. The real pages are measured on the static
 * renderer only, and `--rule` skips them.
 *
 * The two renderers write two tables, never one. A layout rule is `unsupported` under the
 * static renderer and a measured number under the browser one, so a single file would
 * carry whichever renderer ran last and nothing downstream could tell which.
 *
 * Exit codes are set with `process.exitCode` and the module returns, never `process.exit`:
 * when stdout is a pipe the final writes are asynchronous and an immediate exit drops them.
 */

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const ruleIndex = argv.indexOf('--rule');
const onlyRule = ruleIndex === -1 ? undefined : argv[ruleIndex + 1];
const rendererIndex = argv.indexOf('--renderer');
const rendererName = rendererIndex === -1 ? 'static' : argv[rendererIndex + 1];

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

/** The renderers the harness can measure with. `remote` is a seam with nothing behind it. */
type HarnessRenderer = Extract<RendererId, 'static' | 'browser'>;

/** The files each renderer owns. */
const OUTPUTS: Readonly<
  Record<
    HarnessRenderer,
    { table: string; markdown: string; analysis: string; analysisMarkdown: string }
  >
> = {
  static: {
    table: 'calibration/table.json',
    markdown: 'calibration/README.md',
    analysis: 'calibration/analysis.json',
    analysisMarkdown: 'calibration/ANALYSIS.md',
  },
  browser: {
    table: 'calibration/browser.json',
    markdown: 'calibration/BROWSER.md',
    analysis: 'calibration/analysis-browser.json',
    analysisMarkdown: 'calibration/ANALYSIS-BROWSER.md',
  },
};

function currentCommit(): string | null {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
    // A dirty tree means the numbers cannot be attributed to a commit, and saying so is
    // better than recording a commit the table does not correspond to.
    if (status.trim() !== '') return null;
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * The date the table records.
 *
 * Read from the corpus rather than from the clock when checking, so `--check` is
 * reproducible: a table regenerated tomorrow must compare equal to one generated today
 * if nothing else changed, and a timestamp would make every run a diff.
 */
function generatedDate(checking: boolean, committed: CalibrationTable | null): string {
  if (checking && committed !== null) return committed.generated;
  return new Date().toISOString().slice(0, 10);
}

/**
 * A calibration run renders every corpus case once per engine, several thousand pages in
 * one Chromium, so it gets a longer per-page budget than an interactive scan. The budget
 * decides whether a slow machine finishes the run, never what a page is graded.
 */
const BROWSER_PAGE_TIMEOUT_MS = 120_000;

function rendererFor(name: HarnessRenderer): Renderer {
  return name === 'browser'
    ? new BrowserRenderer({ timeoutMs: BROWSER_PAGE_TIMEOUT_MS })
    : new StaticRenderer();
}

/**
 * The cap on one engine evaluating one real page, the same for every engine (D-008). An
 * evaluation past it is terminated and recorded as errored, never as a pass.
 */
const REAL_PAGE_TIMEOUT_MS = 600_000;
/** Heap for one evaluation. A worker that runs out is recorded as errored too. */
const REAL_PAGE_HEAP_MB = 4_096;

async function measureRealPages(
  actOnly: CalibrationTable,
  engines: readonly Engine[],
  name: RealCorpusName,
): Promise<{ block: NonNullable<CalibrationTable['realCorpus']>; cells: readonly RealPageCell[] }> {
  const real = loadRealCorpus(ROOT, name);
  const concurrency = Math.max(1, Math.min(4, availableParallelism() - 1));
  console.log(
    `\nMeasuring ${String(engines.length)} engines over ${String(real.pages.length)} pages in corpus/${name}, ` +
      `${String(concurrency)} at a time, each capped at ${String(REAL_PAGE_TIMEOUT_MS / 1000)} s.`,
  );
  let logged = 0;
  const { block, errors, cells } = await runRealHarness({
    corpus: real,
    adjudication: loadAdjudication(ROOT, name),
    engines: engines.map((e) => ({ id: e.id, claimedRules: e.mapping.claimedRules })),
    implementedRules: IMPLEMENTED_RULES,
    routing: actOnly.routing,
    concurrency,
    evaluate: (page, engine, rules) => {
      const job: WorkerJob = { html: real.read(page), url: page.url, engine, rules };
      return runWorker(
        () =>
          new Worker(new URL('./real-worker.js', import.meta.url), {
            workerData: job,
            resourceLimits: { maxOldGenerationSizeMb: REAL_PAGE_HEAP_MB },
          }),
        REAL_PAGE_TIMEOUT_MS,
      );
    },
    onProgress: (done, total) => {
      const percent = Math.floor((done / total) * 100);
      if (percent >= logged + 10) {
        logged = percent;
        console.log(`  ${String(percent)}%  (${String(done)}/${String(total)})`);
      }
    },
  });
  for (const error of errors) {
    console.log(`  errored: ${error.page} / ${error.engine}: ${error.reason}`);
  }
  const { adjudication } = block;
  console.log(
    `corpus/${name}: ${String(adjudication.ratedCells)} of ${String(adjudication.totalCells)} cells rated, ` +
      `${String(adjudication.resolvedCells)} resolved (${adjudication.status}).`,
  );
  return { block, cells };
}

/** Both real-page corpora, each in its own block. The held-out one only once it exists. */
async function measureAllRealPages(
  actOnly: CalibrationTable,
  engines: readonly Engine[],
): Promise<{ table: CalibrationTable; cells: readonly RealPageCell[] }> {
  const real = await measureRealPages(actOnly, engines, 'real');
  const heldOut = existsSync(resolve(ROOT, 'corpus/heldout/MANIFEST.json'))
    ? await measureRealPages(actOnly, engines, 'heldout')
    : null;
  return {
    table: CalibrationTable.parse({
      ...actOnly,
      realCorpus: real.block,
      ...(heldOut === null ? {} : { heldOutCorpus: heldOut.block }),
    }),
    cells: real.cells,
  };
}

async function main(): Promise<number> {
  if (rendererName !== 'static' && rendererName !== 'browser') {
    console.error(`Unknown renderer "${rendererName ?? ''}". Use static or browser.`);
    return 2;
  }
  const outputs = OUTPUTS[rendererName];
  const tablePath = resolve(ROOT, outputs.table);
  const markdownPath = resolve(ROOT, outputs.markdown);

  const corpus = loadCorpus(ROOT);
  const renderer = rendererFor(rendererName);
  const engines = [new MarloEngine(), ...peerEngines()];

  let committed: CalibrationTable | null = null;
  try {
    committed = CalibrationTable.parse(JSON.parse(readFileSync(tablePath, 'utf8')));
  } catch {
    committed = null;
  }

  const rules = onlyRule === undefined ? undefined : [onlyRule];

  console.log(
    `Calibrating ${String(engines.length)} engines over ${onlyRule ?? 'every claimed rule'} ` +
      `against ${String(corpus.totals.testCases)} official test cases, with the ` +
      `${rendererName} renderer.`,
  );

  let lastLogged = 0;
  // Every engine's graded outcome on every case, observed during the one harness pass, for
  // the analysis. Single-rule runs skip it: an analysis of one rule is not the analysis.
  const observations: Parameters<typeof collectCases>[0][number][] = [];
  let table: CalibrationTable;
  try {
    table = await runHarness({
      corpus,
      renderer,
      engines,
      ...(rules === undefined ? {} : { rules }),
      autoFix: { minStrictPrecision: 0.95, minSampleSize: 6 },
      commit: currentCommit(),
      generated: generatedDate(checkOnly, committed),
      ...(onlyRule === undefined
        ? {
            onCase: ({ actRuleId, engine, testCase, graded }) => {
              observations.push({
                actRuleId,
                engine,
                path: testCase.path,
                expected: testCase.expected,
                actual: graded.actual,
              });
            },
          }
        : {}),
      onProgress: (done, total) => {
        const percent = Math.floor((done / total) * 100);
        if (percent >= lastLogged + 10) {
          lastLogged = percent;
          console.log(`  ${String(percent)}%  (${String(done)}/${String(total)})`);
        }
      },
    });
  } catch (error) {
    if (error instanceof PlaywrightMissingError) {
      console.error(`\n${error.message}`);
      return 2;
    }
    throw error;
  } finally {
    await renderer.dispose();
  }

  // Validated before it is written or compared. An unvalidated table is how a published
  // error rate quietly becomes a different number.
  const actOnly = CalibrationTable.parse(table);
  const measured =
    onlyRule === undefined && rendererName === 'static'
      ? await measureAllRealPages(actOnly, engines)
      : { table: actOnly, cells: [] };
  const validated = measured.table;
  const analysis =
    onlyRule === undefined
      ? analyse({
          table: validated,
          cases: collectCases(observations),
          implementedRules: IMPLEMENTED_RULES,
          realCells: measured.cells,
        })
      : null;

  console.log('');
  console.log(
    `Coverage: ${String(validated.coverage.implemented)} of ${String(validated.coverage.publishedActRules)} published ACT rules`,
  );
  console.log(
    `Strict precision: ${validated.aggregate.strictPrecision?.toFixed(4) ?? 'not measured'}`,
  );
  console.log(
    `Strict recall:    ${validated.aggregate.strictRecall?.toFixed(4) ?? 'not measured'}`,
  );
  console.log(
    `False positives:  ${validated.aggregate.falsePositiveRate?.toFixed(4) ?? 'not measured'}`,
  );
  console.log(`Sample size:      ${String(validated.aggregate.sampleSize)} test cases`);

  const flattered = validated.entries.filter((e) => e.flatteredByProtocol);
  console.log(
    `Officially consistent but missing over half the violations: ${String(flattered.length)} entries`,
  );

  if (onlyRule !== undefined) {
    console.log('');
    for (const entry of validated.entries.filter((e) => e.mappingKind !== 'none')) {
      console.log(
        `  ${entry.engine.padEnd(10)} ${entry.act.consistency.padEnd(11)} ` +
          `P=${entry.strict.precision?.toFixed(2) ?? 'n/a'} R=${entry.strict.recall?.toFixed(2) ?? 'n/a'} ` +
          `cantTell=${String(entry.strict.cantTellOnFailed)}/${String(entry.strict.cantTellOnPassed)} ` +
          `[${entry.mappingKind}]`,
      );
    }
    console.log('\nSingle-rule run: nothing written.');
    return 0;
  }

  if (checkOnly) {
    if (committed === null) {
      console.error(
        `\nNo committed ${outputs.table} to compare against. Run \`pnpm calibrate` +
          `${rendererName === 'browser' ? ' --renderer browser' : ''}\`.`,
      );
      return 1;
    }
    const { regressions, improvements } = findRegressions(committed, validated);

    for (const improvement of improvements) {
      console.log(`  improved: ${improvement.what} ${improvement.before} -> ${improvement.after}`);
    }

    const realChanges = findRealCorpusChanges(committed, validated);
    if (realChanges.length > 0) {
      console.error(`\nA real-page block moved (${String(realChanges.length)} change(s)):\n`);
      for (const change of realChanges) console.error(`  ${change}`);
      console.error(
        '\nThese figures have no better or worse until ground truth exists, so any movement fails.\n' +
          'Find out why it moved, then regenerate with `pnpm calibrate` and say why in the pull request.\n',
      );
    }

    if (regressions.length > 0) {
      console.error(`\n${String(regressions.length)} regression(s):\n`);
      for (const regression of regressions) {
        console.error(`  ${regression.what}: ${regression.before} -> ${regression.after}`);
      }
      console.error(
        '\nA published accuracy number got worse. That is allowed, and it is not allowed to happen\n' +
          'quietly: regenerate the table with `pnpm calibrate`, and say in the pull request which\n' +
          'number moved and why. CHANGELOG.md has an Accuracy section for exactly this.\n',
      );
      return 1;
    }

    if (improvements.length > 0) {
      console.error(
        '\nNumbers improved but the committed table was not regenerated. Run `pnpm calibrate` so\n' +
          'the published figures match the measurement.\n',
      );
      return 1;
    }

    if (realChanges.length > 0) return 1;

    // The analysis has no better or worse either: any figure in it that moved is a result
    // to explain, so a regenerated analysis has to equal the committed one exactly, apart
    // from the date and commit it records.
    if (analysis !== null) {
      const analysisPath = resolve(ROOT, outputs.analysis);
      let committedAnalysis: AnalysisReport | null = null;
      try {
        committedAnalysis = AnalysisReport.parse(JSON.parse(readFileSync(analysisPath, 'utf8')));
      } catch {
        committedAnalysis = null;
      }
      const comparable = (a: AnalysisReport): string =>
        JSON.stringify({ ...a, generated: null, commit: null });
      if (committedAnalysis === null || comparable(committedAnalysis) !== comparable(analysis)) {
        console.error(
          `\n${outputs.analysis} ${committedAnalysis === null ? 'is missing or invalid' : 'does not match the harness'}. ` +
            'Regenerate it with `pnpm calibrate` and say in the pull request which figure moved and why.\n',
        );
        return 1;
      }
    }

    console.log(
      rendererName === 'static'
        ? '\ncalibrate --check: no regression, and neither real-page block moved.'
        : '\ncalibrate --check: no regression.',
    );
    return 0;
  }

  writeFileSync(tablePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderCalibrationMarkdown(validated), 'utf8');
  console.log(`\nWrote ${outputs.table} and ${outputs.markdown}`);
  if (analysis !== null) {
    writeFileSync(
      resolve(ROOT, outputs.analysis),
      `${JSON.stringify(analysis, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      resolve(ROOT, outputs.analysisMarkdown),
      renderAnalysisMarkdown(analysis),
      'utf8',
    );
    console.log(`Wrote ${outputs.analysis} and ${outputs.analysisMarkdown}`);
  }
  return 0;
}

process.exitCode = await main();
