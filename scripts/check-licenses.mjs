#!/usr/bin/env node
/**
 * Keeps docs/licenses.md honest.
 *
 * Two failures, both of which have shipped in real projects:
 *
 *   A production dependency arrives and nobody reasons about its licence. The
 *   ledger says nothing, so the reader concludes there is nothing to say.
 *
 *   A licence outside the allow-list arrives transitively. Marlo needs to be
 *   embeddable by the tools it measures, including the closed ones, or it cannot
 *   work as a shared calibration harness. GPL or AGPL in a production dependency
 *   would end that, quietly, in a lockfile diff nobody read.
 *
 * The check reads the ledger rather than generating it, because the column that
 * matters is "obligation" and no tool can infer that.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Permissive licences Marlo can ship inside an MIT distribution without the
 * obligation reaching Marlo's own source.
 *
 * MPL-2.0 is on the list with a condition attached: it is file-scoped, so it
 * applies only while the covered files are unmodified. docs/licenses.md carries
 * the reasoning for axe-core specifically.
 */
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'MPL-2.0',
  'Python-2.0',
]);

/** Refused outright, with the reason printed on failure. */
const REFUSED = {
  'GPL-2.0': "Copyleft reaches Marlo's own source. See docs/licenses.md.",
  'GPL-3.0': "Copyleft reaches Marlo's own source. See docs/licenses.md.",
  'AGPL-3.0': 'Network copyleft. Would make Marlo unembeddable by the tools it measures.',
  'LGPL-3.0': 'Weak copyleft with dynamic-linking conditions Marlo cannot guarantee downstream.',
  'SSPL-1.0': 'Not recognised as open source and incompatible with the harness goal.',
  'BUSL-1.1': 'Source-available, not open source.',
  'CC-BY-NC-4.0': 'Non-commercial restriction.',
};

function normalise(raw) {
  if (typeof raw !== 'string') return 'UNKNOWN';
  // "(MIT OR Apache-2.0)" and "MIT AND ISC" both appear in the wild.
  return raw.replace(/[()]/g, '').trim();
}

function expressionParts(expr) {
  return expr
    .split(/\s+(?:OR|AND)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

function productionDependencies() {
  // --prod excludes devDependencies. --depth Infinity includes transitives,
  // which is where an unexpected licence actually arrives.
  const raw = execFileSync(
    'pnpm',
    ['licenses', 'list', '--prod', '--json', '--long', '--recursive'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw);
  const out = [];
  for (const [license, entries] of Object.entries(parsed)) {
    for (const entry of entries) {
      out.push({ name: entry.name, version: entry.version, license: normalise(license) });
    }
  }
  return out;
}

const ledger = readFileSync(resolve(ROOT, 'docs/licenses.md'), 'utf8');

let deps;
try {
  deps = productionDependencies();
} catch (error) {
  console.error('check-licenses: could not read the dependency tree.');
  console.error('Run `pnpm install` first. Underlying error:');
  console.error(String(error instanceof Error ? error.message : error).split('\n')[0]);
  process.exit(2);
}

const problems = [];
const missing = [];

for (const dep of deps) {
  // Workspace packages are Marlo's own and are MIT by the root LICENSE.
  if (dep.name.startsWith('@marlo/') || dep.name === 'marlo') continue;

  for (const part of expressionParts(dep.license)) {
    if (Object.hasOwn(REFUSED, part)) {
      problems.push(`${dep.name}@${dep.version} is ${part}. ${REFUSED[part]}`);
    } else if (!ALLOWED.has(part)) {
      problems.push(
        `${dep.name}@${dep.version} is ${part}, which is not on the allow-list in ` +
          'scripts/check-licenses.mjs. Add it there with the reasoning, or drop the dependency.',
      );
    }
  }

  // Direct dependencies must appear in the ledger by name. Transitives are
  // covered by the allow-list: listing 400 transitive packages by hand would
  // produce a document nobody maintains, which is worse than a shorter true one.
  const isDirect =
    ledger.includes('`' + dep.name + '`') || ledger.includes('`' + dep.name.split('/')[0] + '-*`');
  if (!isDirect) missing.push(dep);
}

const rootPkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const declaredDirect = new Set(Object.keys(rootPkg.dependencies ?? {}));
const undocumentedDirect = missing.filter((d) => declaredDirect.has(d.name));

if (undocumentedDirect.length > 0) {
  problems.push(
    'These direct production dependencies are not in docs/licenses.md:\n' +
      undocumentedDirect.map((d) => `    ${d.name}@${d.version} (${d.license})`).join('\n') +
      '\n  Add a row with the obligation filled in, not just the licence name.',
  );
}

if (problems.length > 0) {
  console.error(`\ncheck-licenses: ${String(problems.length)} problems\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(
  `check-licenses: ${String(deps.length)} production packages, all licences allowed and ` +
    'direct dependencies documented.',
);
