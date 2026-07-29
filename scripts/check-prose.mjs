#!/usr/bin/env node
/**
 * Two writing rules, enforced instead of hoped for.
 *
 *   No em dashes. A colon, a comma, parentheses, or a full stop. If a sentence
 *   needs one, the sentence needs rewriting.
 *
 *   No AI slop vocabulary. The specific words that signal text nobody chose.
 *   This repository is read by an audience with excellent historical reasons to
 *   distrust overstated tooling, and prose that reads as generated is the first
 *   thing they will notice.
 *
 * Applies to code comments and documentation alike, because the same people read
 * both.
 *
 * Usage: node scripts/check-prose.mjs [paths...]
 */
import { NOT_OUR_PROSE, PROSE_RULES } from './lib/rule-data.mjs';
import { filesToScan, findMatches } from './lib/scan.mjs';

const messages = new Map(PROSE_RULES.map((r) => [r.id, r.message]));
const files = filesToScan(process.argv.slice(2), NOT_OUR_PROSE);
const failures = files.flatMap((f) => findMatches(f, PROSE_RULES));

if (failures.length > 0) {
  console.error(`\ncheck-prose: ${String(failures.length)} problems\n`);
  for (const f of failures) {
    console.error(`  ${f.file}:${String(f.line)}  [${f.id}]  "${f.match}"`);
    console.error(`    ${messages.get(f.id) ?? ''}`);
    console.error(`    at: ${f.context}\n`);
  }
  process.exit(1);
}

console.log(`check-prose: ${String(files.length)} files, clean.`);
