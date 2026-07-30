#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CalibrationTable } from '@marlo/schema';
import { StaticRenderer } from '@marlo/render';
import { peerEngines } from '@marlo/engines';
import { loadCorpus } from './corpus.js';
import { MarloEngine } from './marlo-engine.js';
import { runHarness } from './harness.js';
import { findRegressions, renderCalibrationMarkdown } from './publish.js';

/**
 * Regenerates the calibration table.
 *
 *   pnpm calibrate                 write calibration/table.json and README.md
 *   pnpm calibrate --check         regenerate in memory and fail on a regression
 *   pnpm calibrate --rule <actId>  measure one rule, for developing a mapping
 *
 * `--check` is the CI gate. It is a required status, because a false positive rate that
 * can drift without failing a build is a marketing number.
 */

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const ruleIndex = argv.indexOf('--rule');
const onlyRule = ruleIndex === -1 ? undefined : argv[ruleIndex + 1];

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const TABLE = resolve(ROOT, 'calibration/table.json');
const MARKDOWN = resolve(ROOT, 'calibration/README.md');

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

const corpus = loadCorpus(ROOT);
const renderer = new StaticRenderer();
const engines = [new MarloEngine(), ...peerEngines()];

let committed: CalibrationTable | null = null;
try {
  committed = CalibrationTable.parse(JSON.parse(readFileSync(TABLE, 'utf8')));
} catch {
  committed = null;
}

const rules = onlyRule === undefined ? undefined : [onlyRule];

console.log(
  `Calibrating ${String(engines.length)} engines over ${onlyRule ?? 'every claimed rule'} ` +
    `against ${String(corpus.totals.testCases)} official test cases.`,
);

let lastLogged = 0;
const table = await runHarness({
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

await renderer.dispose();

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
console.log(`Strict recall:    ${validated.aggregate.strictRecall?.toFixed(4) ?? 'not measured'}`);
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
  process.exit(0);
}

if (checkOnly) {
  if (committed === null) {
    console.error(
      '\nNo committed calibration/table.json to compare against. Run `pnpm calibrate`.',
    );
    process.exit(1);
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
    process.exit(1);
  }

  if (improvements.length > 0) {
    console.error(
      '\nNumbers improved but the committed table was not regenerated. Run `pnpm calibrate` so\n' +
        'the published figures match the measurement.\n',
    );
    process.exit(1);
  }

  console.log('\ncalibrate --check: no regression.');
  process.exit(0);
}

writeFileSync(TABLE, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
writeFileSync(MARKDOWN, renderCalibrationMarkdown(validated), 'utf8');
console.log(`\nWrote calibration/table.json and calibration/README.md`);
