#!/usr/bin/env node
/**
 * Developer Certificate of Origin, checked locally so the required status check
 * on GitHub is never the first time you hear about it.
 *
 * Also refuses machine Author emails and AI co-author trailers, so credit stays
 * on GitHub-linked human accounts (CONTRIBUTING.md, DECISIONS.md D-013).
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
import { pathToFileURL } from 'node:url';

const SIGNOFF = /^Signed-off-by: (.+) <([^<>@\s]+@[^<>\s]+)>$/;

/** Emails that never link to a GitHub account. */
const UNLINKABLE_EMAIL =
  /(?:\.local|macbook|hsd1\.[a-z0-9.-]+\.comcast\.net|users\.noreply\.t3\.)/i;

/** Trailers that attribute work to an AI product rather than a human account. */
const AI_COAUTHOR = /^Co-authored-by:\s*.*(?:Claude|Anthropic|T3 Code|noreply@anthropic\.com)/im;

/**
 * @param {string} message
 * @param {string} label
 * @returns {string[]}
 */
export function problems(message, label) {
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
  }

  for (const line of signoffs) {
    if (!SIGNOFF.test(line)) {
      found.push(
        `${label}: malformed sign-off.\n` +
          `  got:      ${line}\n` +
          '  expected: Signed-off-by: Your Name <you@example.com>',
      );
      continue;
    }
    const match = /<([^>]+)>/.exec(line);
    const email = match?.[1] ?? '';
    found.push(...emailProblems(email, label, 'Signed-off-by'));
  }

  if (AI_COAUTHOR.test(message)) {
    found.push(
      `${label}: AI Co-authored-by trailer is refused.\n` +
        '  Why:       Commit credit is for GitHub-linked human accounts.\n' +
        '  Fix:       Remove Co-authored-by lines for Claude, Anthropic, or T3 Code.\n' +
        '  See:       CONTRIBUTING.md#credit-and-authorship',
    );
  }

  return found;
}

/**
 * @param {string} email
 * @param {string} label
 * @param {string} field
 * @returns {string[]}
 */
export function emailProblems(email, label, field = 'Author') {
  if (email === '') return [];
  if (!UNLINKABLE_EMAIL.test(email)) return [];
  return [
    `${label}: ${field} email will not link on GitHub.\n` +
      `  got:      ${email}\n` +
      '  Fix:       Use your GitHub noreply address or a verified email on the account.\n' +
      '  See:       CONTRIBUTING.md#credit-and-authorship',
  ];
}

/**
 * @param {string[]} argv
 * @returns {number} process exit code
 */
export function run(argv) {
  let failures = [];

  if (argv[0] === '--range') {
    const range = argv[1];
    if (range === undefined) {
      console.error('check-signoff: --range needs a value, for example origin/main..HEAD');
      return 2;
    }
    const shas = execFileSync('git', ['rev-list', '--no-merges', range], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);

    if (shas.length === 0) {
      console.log('check-signoff: no commits in range.');
      return 0;
    }

    for (const sha of shas) {
      const payload = execFileSync('git', ['log', '-1', '--format=%ae%n%ce%n%B', sha], {
        encoding: 'utf8',
      });
      const nl1 = payload.indexOf('\n');
      const nl2 = payload.indexOf('\n', nl1 + 1);
      const authorEmail = payload.slice(0, nl1);
      const committerEmail = payload.slice(nl1 + 1, nl2);
      const message = payload.slice(nl2 + 1);
      const label = sha.slice(0, 8);
      failures = failures.concat(problems(message, label));
      failures = failures.concat(emailProblems(authorEmail, label, 'Author'));
      // Committer is often the merger on rebase; only reject unlinkable machine forms.
      failures = failures.concat(emailProblems(committerEmail, label, 'Committer'));
    }
    if (failures.length === 0) {
      console.log(`check-signoff: ${String(shas.length)} commits, all signed off.`);
    }
  } else {
    const path = argv[0];
    if (path === undefined) {
      console.error('check-signoff: pass a commit message file, or --range <base>..<head>');
      return 2;
    }
    failures = problems(readFileSync(path, 'utf8'), 'commit');
    // commit-msg runs after Author is chosen; refuse a machine identity before the commit lands.
    try {
      const ident = execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], { encoding: 'utf8' }).trim();
      const emailMatch = /<([^>]+)>/.exec(ident);
      if (emailMatch?.[1] !== undefined) {
        failures = failures.concat(emailProblems(emailMatch[1], 'commit', 'Author'));
      }
    } catch {
      // Outside a git work tree (tests), skip Author lookup.
    }
    if (failures.length === 0) console.log('check-signoff: signed off.');
  }

  if (failures.length > 0) {
    console.error('');
    for (const f of failures) console.error(`${f}\n`);
    return 1;
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exitCode = run(process.argv.slice(2));
}
