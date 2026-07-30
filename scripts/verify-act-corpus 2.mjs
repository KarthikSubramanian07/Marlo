#!/usr/bin/env node
/**
 * Proves the vendored corpus is unmodified. No network.
 *
 * The corpus is the ground truth for every accuracy number Marlo publishes. If a
 * test case can be edited, an inconvenient number can be made convenient by
 * changing the question rather than the answer, and nothing downstream would
 * notice. So every file carries a SHA-256 in MANIFEST.json and this script
 * compares all of them.
 *
 * It also asserts the totals RESEARCH.md quotes. Those numbers appear in the
 * README, on the website, and in the denominator of every coverage fraction. A
 * document that disagrees with the data is worse than no document.
 *
 * Usage: node scripts/verify-act-corpus.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CORPUS = join(ROOT, 'corpus', 'act');

/**
 * The totals as measured on 2026-07-29 and quoted in RESEARCH.md section 1.
 *
 * Upstream is a living corpus, so these will move. When they do, the fix is a
 * regeneration commit that updates both this constant and every document quoting
 * it, in one diff someone reviews. That is the point: a coverage denominator
 * should not be able to change quietly.
 */
const EXPECTED = {
  rules: 94,
  rulesWithTestCases: 91,
  testCases: 1134,
  expected: { passed: 448, failed: 358, inapplicable: 328 },
};

const problems = [];
const note = (message) => problems.push(message);

if (!existsSync(CORPUS)) {
  console.error(`corpus/act is missing. Run \`pnpm corpus:fetch\` (needs network).`);
  process.exit(1);
}

for (const required of ['MANIFEST.json', 'NOTICE.md']) {
  if (!existsSync(join(CORPUS, required))) {
    note(`corpus/act/${required} is missing. The W3C licence requires the notice to travel.`);
  }
}
if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(CORPUS, 'MANIFEST.json'), 'utf8'));

// The notice has to be present and has to still be the notice.
const notice = readFileSync(join(CORPUS, 'NOTICE.md'), 'utf8');
for (const phrase of [
  'W3C Software And Document Notice And License',
  'The full text of this NOTICE in a location viewable to users',
  'Notice of any changes or modifications',
]) {
  if (!notice.includes(phrase)) {
    note(`corpus/act/NOTICE.md no longer contains: "${phrase}"`);
  }
}

// Totals, against both the manifest and the documented figures.
for (const key of ['rules', 'rulesWithTestCases', 'testCases']) {
  if (manifest.totals[key] !== EXPECTED[key]) {
    note(
      `totals.${key} is ${String(manifest.totals[key])}, expected ${String(EXPECTED[key])}. ` +
        'If upstream really changed, update EXPECTED here and every document that quotes it, ' +
        'in the same commit.',
    );
  }
}
for (const outcome of ['passed', 'failed', 'inapplicable']) {
  if (manifest.totals.expected[outcome] !== EXPECTED.expected[outcome]) {
    note(
      `totals.expected.${outcome} is ${String(manifest.totals.expected[outcome])}, ` +
        `expected ${String(EXPECTED.expected[outcome])}.`,
    );
  }
}

// Internal consistency: the manifest must agree with itself before it is trusted
// to describe the files.
if (manifest.testCases.length !== manifest.totals.testCases) {
  note(
    `MANIFEST lists ${String(manifest.testCases.length)} test cases but claims ` +
      `${String(manifest.totals.testCases)}.`,
  );
}
if (manifest.rules.length !== manifest.totals.rules) {
  note(
    `MANIFEST lists ${String(manifest.rules.length)} rules but claims ` +
      `${String(manifest.totals.rules)}.`,
  );
}

const ALLOWED_OUTCOMES = new Set(['passed', 'failed', 'inapplicable']);
const listedPaths = new Set();
let digestMismatches = 0;
let missing = 0;

for (const tc of manifest.testCases) {
  listedPaths.add(tc.path);

  if (!ALLOWED_OUTCOMES.has(tc.expected)) {
    note(`${tc.path}: expected outcome "${tc.expected}" is not one of the three ACT outcomes.`);
    continue;
  }

  const file = join(CORPUS, ...tc.path.split('/'));
  if (!existsSync(file)) {
    missing += 1;
    if (missing <= 5) note(`${tc.path}: listed in MANIFEST but not on disk.`);
    continue;
  }
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (actual !== tc.sha256) {
    digestMismatches += 1;
    if (digestMismatches <= 5) {
      note(
        `${tc.path}: digest mismatch. Expected ${tc.sha256.slice(0, 12)}, got ${actual.slice(0, 12)}.`,
      );
    }
  }
}

if (missing > 5) note(`...and ${String(missing - 5)} more missing files.`);
if (digestMismatches > 5) note(`...and ${String(digestMismatches - 5)} more digest mismatches.`);

// The other direction: a file on disk that the manifest does not know about. An
// unlisted fixture is how a hand-authored test case would sneak into the corpus
// and get counted as official.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}
const onDisk = existsSync(join(CORPUS, 'testcases')) ? walk(join(CORPUS, 'testcases')) : [];
for (const file of onDisk) {
  const rel = relative(CORPUS, file).split(sep).join('/');
  if (!listedPaths.has(rel)) {
    note(`${rel}: on disk but not in MANIFEST. Nothing unlisted may live in the corpus.`);
  }
}

if (problems.length > 0) {
  console.error(`\ncorpus:verify failed with ${String(problems.length)} problems\n`);
  for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
  if (problems.length > 40) console.error(`  ...and ${String(problems.length - 40)} more.`);
  console.error('\nThe corpus is the ground truth for every accuracy number Marlo publishes.');
  console.error('A test case that can be edited means an inconvenient result can be made');
  console.error('convenient by changing the question. Regenerate with `pnpm corpus:fetch`.\n');
  process.exit(1);
}

const bytes = onDisk.reduce((sum, f) => sum + statSync(f).size, 0);
console.log(
  `corpus:verify: ${String(manifest.totals.testCases)} test cases across ` +
    `${String(manifest.totals.rulesWithTestCases)} of ${String(manifest.totals.rules)} rules, ` +
    `${String(Math.round(bytes / 1024))} KiB, all digests match. Retrieved ${manifest.retrieved}.`,
);
