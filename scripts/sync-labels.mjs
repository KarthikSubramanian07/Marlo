#!/usr/bin/env node
/**
 * Applies .github/labels.yml to the repository.
 *
 * The taxonomy lives in a committed file so it is reviewable and reproducible.
 * A label set that exists only in repository settings drifts, and nobody can see
 * that it drifted.
 *
 * Needs the `gh` CLI, authenticated. Does not delete labels it does not know
 * about: deleting a label removes it from every issue that used it, which is
 * destructive and not something a sync script should decide.
 *
 * Usage: node scripts/sync-labels.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const dryRun = process.argv.includes('--dry-run');

/**
 * A deliberately small YAML reader for exactly the shape labels.yml has: a list
 * of maps with three scalar string fields. Pulling in a YAML parser as a
 * dependency for one file this simple is not a trade worth making, and a general
 * parser would silently accept shapes this script cannot apply.
 */
function parseLabels(text) {
  const labels = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line === '' || line.trimStart().startsWith('#')) continue;

    const start = /^-\s+(\w+):\s*(.*)$/.exec(line);
    if (start) {
      if (current) labels.push(current);
      current = {};
      current[start[1]] = unquote(start[2]);
      continue;
    }
    const cont = /^\s{2}(\w+):\s*(.*)$/.exec(line);
    if (cont && current) {
      current[cont[1]] = unquote(cont[2]);
      continue;
    }
    throw new Error(`labels.yml: cannot parse line: ${line}`);
  }
  if (current) labels.push(current);
  return labels;
}

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  return t;
}

const labels = parseLabels(readFileSync(resolve(ROOT, '.github/labels.yml'), 'utf8'));

for (const label of labels) {
  if (!label.name || !label.color) {
    throw new Error(`labels.yml: entry missing name or color: ${JSON.stringify(label)}`);
  }
  const args = [
    'label',
    'create',
    label.name,
    '--color',
    label.color,
    '--description',
    label.description ?? '',
    '--force',
  ];
  if (dryRun) {
    console.log(`would apply: ${label.name} #${label.color}`);
    continue;
  }
  execFileSync('gh', args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`applied: ${label.name}`);
}

console.log(`\n${String(labels.length)} labels ${dryRun ? 'checked' : 'applied'}.`);
console.log('Labels not in labels.yml are left alone: deleting one would strip it from');
console.log("every issue that used it, which is not a sync script's decision to make.");
