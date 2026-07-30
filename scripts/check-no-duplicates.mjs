#!/usr/bin/env node
/**
 * Fails on files whose names look like a sync-tool duplicate.
 *
 * WHY THIS EXISTS
 *
 * Four of these were committed before anyone noticed: `scripts/verify-act-corpus 2.mjs`
 * and three siblings. A file-syncing tool watching the working directory duplicates a file
 * when it is rewritten faster than the tool can settle, and a rapid series of edits
 * produces `name 2.ext`, `name 3.ext`, and so on.
 *
 * They are harmless individually and corrosive in aggregate: a stale copy of a script sits
 * next to the real one, someone eventually opens the wrong one, and a duplicated
 * `tsconfig` or `package.json` can genuinely change a build. One of them also blocked a
 * `git checkout` mid-rebase, which is how they were found.
 *
 * Matching on the pattern rather than on a tool's name, because the next tool will use the
 * same convention.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** `name 2.ext`, `name 2`, `name copy.ext`, `name copy 2.ext`. */
const DUPLICATE = /(?: \d+| copy(?: \d+)?)(?:\.[^.]+)?$/;
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.wrangler']);

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (DUPLICATE.test(entry.name)) found.push(full);
    if (entry.isDirectory()) found.push(...walk(full));
  }
  return found;
}

const onDisk = walk(ROOT).map((f) => relative(ROOT, f));

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((f) => DUPLICATE.test(f.split('/').pop() ?? ''));

if (onDisk.length === 0 && tracked.length === 0) {
  console.log('check-no-duplicates: clean.');
  process.exit(0);
}

console.error('\nFiles that look like sync-tool duplicates:\n');
for (const file of new Set([...tracked, ...onDisk])) {
  const isTracked = tracked.includes(file);
  const kind = (() => {
    try {
      return statSync(resolve(ROOT, file)).isDirectory() ? 'directory' : 'file';
    } catch {
      return 'missing';
    }
  })();
  console.error(`  ${file}  (${kind}${isTracked ? ', TRACKED IN GIT' : ''})`);
}
console.error(
  '\nA sync tool duplicates a file when it is rewritten faster than the tool settles.\n' +
    'Four of these were committed before anyone noticed, and one blocked a git checkout\n' +
    'mid-rebase. Delete them:\n\n' +
    '  find . -path ./node_modules -prune -o -name "* [0-9].*" -print0 | xargs -0 rm -f\n',
);
process.exit(1);
