#!/usr/bin/env node
/**
 * Developer Certificate of Origin, checked locally so the required status check
 * on GitHub is never the first time you hear about it.
 *
 * Marlo uses the DCO rather than a CLA (DECISIONS.md D-001). The contribution
 * this project most wants is a false positive report from someone who is
 * annoyed that Marlo was wrong about their code. Putting a legal agreement in
 * front of that person is how the highest-value inbound signal gets lost.
 * `git commit -s` is the entire mechanism.
 *
 * Usage:
 *   node scripts/check-signoff.mjs <path-to-commit-msg-file>   (commit-msg hook)
 *   node scripts/check-signoff.mjs --range <base>..<head>      (CI)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SIGNOFF = /^Signed-off-by: (.+) <([^<>@\s]+@[^<>\s]+)>$/;

function problems(message, label) {
  const lines = message.split('\n');
  const subject = (lines[0] ?? '').trim();
  const found = [];

  // Merge commits and fixup commits are not authorship claims.
  if (/^(Merge|Revert|fixup!|squash!)\b/.test(subject)) return [];

  const signoffs = lines.map((l) => l.trim()).filter((l) => l.startsWith('Signed-off-by:'));

  if (signoffs.length === 0) {
    found.push(
      `${label}: no Signed-off-by line.\n` +
        '  Fix with:  git commit --amend -s --no-edit\n' +
        '  Why:       Marlo uses the DCO instead of a CLA. See CONTRIBUTING.md.',
    );
    return found;
  }

  for (const line of signoffs) {
    if (!SIGNOFF.test(line)) {
      found.push(
        `${label}: malformed sign-off.\n` +
          `  got:      ${line}\n` +
          '  expected: Signed-off-by: Your Name <you@example.com>',
      );
    }
  }

  return found;
}

const argv = process.argv.slice(2);
let failures = [];

if (argv[0] === '--range') {
  const range = argv[1];
  if (range === undefined) {
    console.error('check-signoff: --range needs a value, for example origin/main..HEAD');
    process.exit(2);
  }
  const shas = execFileSync('git', ['rev-list', '--no-merges', range], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  if (shas.length === 0) {
    console.log('check-signoff: no commits in range.');
    process.exit(0);
  }

  for (const sha of shas) {
    const message = execFileSync('git', ['log', '-1', '--format=%B', sha], { encoding: 'utf8' });
    failures = failures.concat(problems(message, sha.slice(0, 8)));
  }
  if (failures.length === 0) {
    console.log(`check-signoff: ${String(shas.length)} commits, all signed off.`);
  }
} else {
  const path = argv[0];
  if (path === undefined) {
    console.error('check-signoff: pass a commit message file, or --range <base>..<head>');
    process.exit(2);
  }
  failures = problems(readFileSync(path, 'utf8'), 'commit');
  if (failures.length === 0) console.log('check-signoff: signed off.');
}

if (failures.length > 0) {
  console.error('');
  for (const f of failures) console.error(`${f}\n`);
  process.exit(1);
}
