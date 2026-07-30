#!/usr/bin/env node
/**
 * Works out what to scan, and writes `targets=` to the step output.
 *
 * Changed files on a pull request, everything on a push. Scanning a whole repository on every
 * pull request is how a check becomes slow, and a slow check gets skipped.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const explicit = (process.env['MARLO_FILES'] ?? '').trim();
if (explicit !== '') {
  console.log(`targets=${explicit}`);
  process.exit(0);
}

const eventName = process.env['GITHUB_EVENT_NAME'] ?? '';
const base = process.env['GITHUB_BASE_REF'] ?? '';

function changedHtml() {
  try {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMR', `origin/${base}...HEAD`],
      {
        encoding: 'utf8',
      },
    );
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.html'));
  } catch {
    return null;
  }
}

function allHtml(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'corpus') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) allHtml(full, out);
    else if (entry.name.endsWith('.html')) out.push(relative(process.cwd(), full));
  }
  return out;
}

let targets = [];
if (eventName === 'pull_request' && base !== '') {
  const changed = changedHtml();
  if (changed === null) {
    // A shallow clone cannot produce a diff. Say so rather than silently scanning everything,
    // which would look like the check working while measuring something else.
    console.error(
      'marlo: could not diff against the base branch, which usually means the checkout was ' +
        'shallow. Add `fetch-depth: 0` to actions/checkout, or pass `files:` explicitly. ' +
        'Falling back to every .html file in the repository.',
    );
    targets = allHtml(process.cwd());
  } else {
    targets = changed;
  }
} else {
  targets = allHtml(process.cwd());
}

// Existing files only: a diff lists deletions too, and a scan of a path that is gone is an
// error report about the wrong thing.
targets = targets.filter((path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
});

console.log(`targets=${targets.join(' ')}`);
