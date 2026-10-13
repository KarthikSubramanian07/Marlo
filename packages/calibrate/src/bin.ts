#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RendererId } from '@marlo/schema';
import { CalibrationTable } from '@marlo/schema';
import type { Renderer } from '@marlo/render';
import { BrowserRenderer, PlaywrightMissingError, StaticRenderer } from '@marlo/render';
import { peerEngines } from '@marlo/engines';
import { loadCorpus } from './corpus.js';
import { MarloEngine } from './marlo-engine.js';
import { runHarness } from './harness.js';
import { findRegressions, renderCalibrationMarkdown } from './publish.js';

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
const OUTPUTS: Readonly<Record<HarnessRenderer, { table: string; markdown: string }>> = {
  static: { table: 'calibration/table.json', markdown: 'calibration/README.md' },
  browser: { table: 'calibration/browser.json', markdown: 'calibration/BROWSER.md' },
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
  const validated = CalibrationTable.parse(table);

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

    console.log('\ncalibrate --check: no regression.');
    return 0;
  }

  writeFileSync(tablePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderCalibrationMarkdown(validated), 'utf8');
  console.log(`\nWrote ${outputs.table} and ${outputs.markdown}`);
  return 0;
}

process.exitCode = await main();
