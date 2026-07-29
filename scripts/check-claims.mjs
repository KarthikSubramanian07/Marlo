#!/usr/bin/env node
/**
 * The forbidden-claims check.
 *
 * Fails the build if a claim Marlo is not entitled to make appears anywhere in
 * the repository, including in generated output and golden files. This is the
 * mechanism behind the liability discipline in the README, and it is why that
 * section is a property of the repository rather than a promise in prose.
 *
 * There is no inline suppression comment. An escape hatch here is the same as
 * not having the check, because the first phrase anyone reaches for it with is
 * exactly the phrase that should not ship. Where the repository has to discuss
 * one of these claims in order to argue against it, the discussion is written so
 * the literal string does not appear. RESEARCH.md and DECISIONS.md both do this
 * when describing the sibling project's third defect.
 *
 * Generated artifacts are scanned too. A tool that cannot say a phrase in its
 * README but emits it in a pull request body has not solved anything.
 *
 * Usage: node scripts/check-claims.mjs [paths...]
 */
import { FORBIDDEN_CLAIMS, NOT_OUR_CLAIMS } from './lib/rule-data.mjs';
import { filesToScan, findMatches } from './lib/scan.mjs';

const reasons = new Map(FORBIDDEN_CLAIMS.map((r) => [r.id, r.reason]));
const files = filesToScan(process.argv.slice(2), NOT_OUR_CLAIMS);
const failures = files.flatMap((f) => findMatches(f, FORBIDDEN_CLAIMS));

if (failures.length > 0) {
  console.error(
    `\nForbidden claims: ${String(failures.length)} in ${String(files.length)} files\n`,
  );
  for (const f of failures) {
    console.error(`  ${f.file}:${String(f.line)}:${String(f.column)}  "${f.match}"`);
    console.error(`    why: ${reasons.get(f.id) ?? f.id}`);
    console.error(`    at:  ${f.context}\n`);
  }
  console.error('There is no suppression comment for this check, by design.');
  console.error('If the phrase is needed in order to argue against it, write the argument so');
  console.error('the literal string does not appear. DECISIONS.md D-010 does this.\n');
  process.exit(1);
}

console.log(`check-claims: ${String(files.length)} files, no forbidden claims.`);
