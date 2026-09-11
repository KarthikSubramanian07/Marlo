#!/usr/bin/env node
/**
 * Fails the build when a number in README.md disagrees with the calibration table.
 *
 * WHY THIS EXISTS, AND WHAT IT CAUGHT
 *
 * README.md is the front page, and its first line is the product claim: a published
 * false positive rate. That number is written by hand. Nothing checked it.
 *
 * So when four rules improved and both peer mappings were measured, every generated
 * artifact moved and the front page did not. For a while this repository published
 * 12.9 percent on its first line while the harness measured 6.4, and the whole build
 * stayed green, because `calibration/README.md` is generated, the site is generated
 * from the same table, and the one surface a reader meets first was neither.
 *
 * That is this project's own argument used against it: a number nothing measured. It
 * is not enough that the table is right. The claim a reader sees has to be the same
 * number, and something has to fail when it is not.
 *
 * WHAT IT CHECKS
 *
 * Every figure below is recomputed from `calibration/table.json` using the same pooling
 * the harness uses, and compared to what README.md says:
 *
 *   the headline false positive rate, in the first paragraph and in the badge
 *   the coverage fraction, in the badge
 *   every cell of the per-engine accuracy table
 *   the corpus sample size
 *   the routing counts
 *   the number of rows in the flattered-by-protocol table
 *
 * A PATTERN THAT STOPS MATCHING IS A FAILURE, NOT A PASS
 *
 * The obvious way to write this is to find each claim with a regular expression and
 * compare it. The obvious way is also how the check quietly stops checking: reword the
 * sentence, the pattern misses, nothing compares, the build is green. So every lookup
 * here is required to match, and an unmatched pattern is reported as loudly as a wrong
 * number. If you reword one of these sentences, this script has to be updated in the
 * same commit, on purpose.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
const table = JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8'));

const problems = [];

/** Pools the confusion counts the way `aggregateStrictAccuracy` does. */
function pooled(engineId) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const entry of table.entries) {
    if (entry.engine !== engineId) continue;
    if (entry.mappingKind === 'none' || entry.testCaseCount === 0) continue;
    tp += entry.strict.truePositives;
    fp += entry.strict.falsePositives;
    fn += entry.strict.falseNegatives;
    tn += entry.strict.trueNegatives;
  }
  const ratio = (a, b) => (b === 0 ? null : a / b);
  return {
    rules: new Set(
      table.entries
        .filter((e) => e.engine === engineId && e.mappingKind !== 'none')
        .map((e) => e.actRuleId),
    ).size,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn),
  };
}

/** The README's own vocabulary for a rate, so the comparison is textual rather than fuzzy. */
const rate = (value) => (value === null ? 'not measured' : value.toFixed(3));
const percent = (value) => (value === null ? 'not measured' : `${(value * 100).toFixed(1)}%`);

/**
 * Finds exactly one match, or records a problem. Zero matches means the claim was
 * reworded and this check went blind, which is reported rather than ignored.
 */
function claim(what, pattern) {
  const matches = [...readme.matchAll(pattern)];
  if (matches.length === 0) {
    problems.push(`${what}: no longer present in README.md. Reword the check, not just the prose.`);
    return null;
  }
  return matches;
}

let compared = 0;

function expect(what, actual, wanted) {
  // Null or undefined means `claim` already recorded that the pattern went blind. It is
  // a failure, and it has been reported, so there is nothing left to compare.
  if (actual === null || actual === undefined) return;
  for (const found of actual) {
    compared += 1;
    if (found !== wanted) problems.push(`${what}: README says ${found}, the table says ${wanted}`);
  }
}

const marlo = pooled('marlo');

// The first line of the repository, and the badge that repeats it.
expect(
  'headline false positive rate',
  claim('headline false positive rate', /Our false positive rate is ([\d.]+%)\./g)?.map(
    (m) => m[1],
  ),
  percent(marlo.falsePositiveRate),
);
expect(
  'false positive badge',
  claim('false positive badge', /false_positives-([\d.]+)%25-/g)?.map((m) => `${m[1]}%`),
  percent(marlo.falsePositiveRate),
);
expect(
  'coverage badge',
  claim('coverage badge', /ACT_rules-(\d+)_of_(\d+)-/g)?.map((m) => `${m[1]} of ${m[2]}`),
  `${String(table.coverage.implemented)} of ${String(table.coverage.publishedActRules)}`,
);
expect(
  'corpus sample size',
  claim('corpus sample size', /Four engines, ([\d,]+) official test case outcomes/g)?.map(
    (m) => m[1],
  ),
  String(table.aggregate.sampleSize),
);

// The per-engine table. Every cell, not only Marlo's row.
const LABELS = {
  Alfa: 'alfa',
  'axe-core': 'axe-core',
  Marlo: 'marlo',
  'HTML CodeSniffer': 'htmlcs',
};
for (const [label, id] of Object.entries(LABELS)) {
  const row = claim(
    `${label} row`,
    new RegExp(
      `\\|\\s*\\*{0,2}${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\*{0,2}\\s*\\|` +
        `\\s*\\*{0,2}(\\d+)\\*{0,2}\\s*\\|\\s*\\*{0,2}([\\d.]+|not measured)\\*{0,2}\\s*\\|` +
        `\\s*\\*{0,2}([\\d.]+|not measured)\\*{0,2}\\s*\\|\\s*\\*{0,2}([\\d.]+%|not measured)\\*{0,2}\\s*\\|`,
      'g',
    ),
  );
  if (row === null) continue;
  const want = pooled(id);
  expect(
    `${label} rules`,
    row.map((m) => m[1]),
    String(want.rules),
  );
  expect(
    `${label} precision`,
    row.map((m) => m[2]),
    rate(want.precision),
  );
  expect(
    `${label} recall`,
    row.map((m) => m[3]),
    rate(want.recall),
  );
  expect(
    `${label} false positives`,
    row.map((m) => m[4]),
    percent(want.falsePositiveRate),
  );
}

// Routing, stated in prose next to the table.
const routed = {};
for (const decision of table.routing) {
  const key = decision.chosen ?? 'nobody';
  routed[key] = (routed[key] ?? 0) + 1;
}
expect(
  'routing counts',
  claim(
    'routing counts',
    /router sends (\d+) rules to axe-core against (\d+) to Marlo's own engine/g,
  )?.map((m) => `${m[1]}/${m[2]}`),
  `${String(routed['axe-core'] ?? 0)}/${String(routed['marlo'] ?? 0)}`,
);

// The flattered-by-protocol table, which is the point of publishing two views.
const flattered = table.entries.filter((e) => e.flatteredByProtocol);
const NUMBER_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
];
expect(
  'flattered entry count',
  claim('flattered entry count', /(\w+) entries currently grade as officially/g)?.map((m) => m[1]),
  NUMBER_WORDS[flattered.length] ?? String(flattered.length),
);
const listed = [
  ...readme.matchAll(/^\| `([0-9a-z]{6})` +\| \*{0,2}[\w-]+\*{0,2} +\| consistent +\|/gm),
].map((m) => m[1]);
const wanted = [...new Set(flattered.map((e) => e.actRuleId))].sort();
if (listed.length === 0) {
  problems.push('flattered table: no rows found in README.md');
} else if ([...new Set(listed)].sort().join(' ') !== wanted.join(' ')) {
  problems.push(
    `flattered table: README lists ${[...new Set(listed)].sort().join(' ')}, the table says ${wanted.join(' ')}`,
  );
}

if (problems.length > 0) {
  console.error('\nREADME.md disagrees with calibration/table.json:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\nThe table is generated by the harness and the README is written by hand, so the README\n' +
      'is what is wrong. Run `pnpm calibrate`, read the diff, and update the prose to match.\n',
  );
  process.exitCode = 1;
} else {
  console.log(
    `check-published-numbers: README.md agrees with the table on ${String(compared)} figures ` +
      `and on the ${String(flattered.length)} rules the protocol flatters.`,
  );
}
