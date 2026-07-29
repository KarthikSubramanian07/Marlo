/**
 * Shared file selection for the two repository scanners.
 *
 * Kept separate so check-claims.mjs and check-prose.mjs cannot drift on which
 * files they look at. A checker that silently stops scanning a directory is
 * indistinguishable from a checker that finds nothing there, which is the
 * failure mode this repository argues against everywhere else.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { SELF } from './rule-data.mjs';

export const ROOT = resolve(import.meta.dirname, '..', '..');

const TEXTUAL = /\.(md|txt|ts|tsx|js|mjs|cjs|json|jsonc|ya?ml|html|css|svg|sarif|diff|patch)$/i;

function tracked() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

/**
 * @param {string[]} argv paths from the command line, or empty for everything tracked
 * @param {RegExp[]} notOurs paths whose bytes belong to someone else
 * @returns {string[]} repository-relative paths to scan
 */
export function filesToScan(argv, notOurs) {
  return (
    (argv.length > 0 ? argv.map((p) => relative(ROOT, resolve(p))) : tracked())
      .filter((f) => TEXTUAL.test(f))
      .filter((f) => !notOurs.some((re) => re.test(f)))
      // The rule definitions. See the comment at the top of rule-data.mjs, and
      // rule-data.test.mjs, which asserts this skip is exactly one file.
      .filter((f) => f !== SELF)
      .filter((f) => {
        try {
          return statSync(resolve(ROOT, f)).isFile();
        } catch {
          return false;
        }
      })
  );
}

/**
 * Finds every match of every rule in one file, with line and column.
 *
 * @param {string} file repository-relative path
 * @param {{id: string, pattern: RegExp}[]} rules
 * @returns {{file: string, line: number, column: number, id: string, match: string, context: string}[]}
 */
export function findMatches(file, rules) {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  const lines = text.split('\n');
  const hits = [];

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const line = before.split('\n').length;
      hits.push({
        file,
        line,
        column: m.index - before.lastIndexOf('\n'),
        id: rule.id,
        match: m[0].replace(/\s+/g, ' ').slice(0, 80),
        context: (lines[line - 1] ?? '').trim().slice(0, 160),
      });
      if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex += 1;
    }
  }
  return hits;
}
