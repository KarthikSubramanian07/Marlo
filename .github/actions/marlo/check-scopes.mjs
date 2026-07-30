#!/usr/bin/env node
/**
 * Refuses to run under a token that can write to the repository.
 *
 * WHY THIS EXISTS AS A SEPARATE STEP, FIRST
 *
 * Marlo promises it never merges, never pushes to a default branch, never force pushes, never
 * rewrites history and never deploys. In a GitHub Action that promise has nothing to do with
 * what the code does. Any step in a job with `contents: write` can push, and a reviewer
 * reading this action cannot tell whether it does without reading all of it.
 *
 * So the boundary is moved somewhere a reviewer can check in one line: the action refuses to
 * run at all if it was handed a permission it does not need. If somebody adds a push step
 * later, they have to also delete this check, and deleting it is a diff that says exactly what
 * it is doing.
 *
 * WHAT IT CAN AND CANNOT SEE
 *
 * GitHub does not expose the resolved permission set to a step. What it does expose is
 * GITHUB_TOKEN_PERMISSIONS on newer runners, and the event payload. The check uses whatever it
 * can read and says which of them it used, rather than reporting a pass it did not earn.
 *
 * That honesty matters more here than a green tick: a scope check that silently degrades to
 * "no data, therefore fine" is exactly the class of defect HONESTY.md is about.
 */

const FORBIDDEN = [
  // Anything that can change the repository's contents or history.
  'contents',
  // Anything that can move code between branches or approve it.
  'pull-requests-write-is-separate',
];

/** Permissions this action is allowed to hold, and what each is for. */
const ALLOWED = {
  contents: ['read', 'none'],
  'pull-requests': ['read', 'write', 'none'],
  checks: ['read', 'write', 'none'],
  'security-events': ['read', 'write', 'none'],
  actions: ['read', 'none'],
  metadata: ['read', 'none'],
  statuses: ['read', 'write', 'none'],
  issues: ['read', 'write', 'none'],
};

const raw = process.env['GITHUB_TOKEN_PERMISSIONS'] ?? '';
const problems = [];
let checked = false;

if (raw.trim() !== '') {
  checked = true;
  // The runner exposes this as a JSON object, for example {"contents":"read"}.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    problems.push(
      `GITHUB_TOKEN_PERMISSIONS was set and did not parse as JSON, so the scopes could not be ` +
        `checked: ${raw.slice(0, 200)}`,
    );
    parsed = null;
  }

  if (parsed !== null && typeof parsed === 'object') {
    for (const [scope, level] of Object.entries(parsed)) {
      // `contents` gets its own message below, which says why rather than only what.
      if (scope === 'contents') continue;
      const allowed = ALLOWED[scope];
      if (allowed === undefined) {
        problems.push(
          `the job grants \`${scope}: ${String(level)}\`, which this action has no use for. ` +
            `Marlo asks for the narrowest set that does the work, and an unused scope is a ` +
            `capability nobody is watching.`,
        );
        continue;
      }
      if (!allowed.includes(String(level))) {
        problems.push(
          `the job grants \`${scope}: ${String(level)}\`. Marlo will not run with it. ` +
            `Permitted: ${allowed.join(', ')}.`,
        );
      }
    }

    if (String(parsed['contents'] ?? 'none') === 'write') {
      problems.push(
        'the job grants `contents: write`. Marlo never commits, pushes, force pushes, ' +
          'rewrites history or deploys, so it does not need that permission and will not ' +
          'accept it. Use `contents: read`.',
      );
    }
  }
}

// The pull request comment is the only write this action performs, and it is opt-in.
if (process.env['MARLO_COMMENT'] === 'true') {
  console.log(
    'marlo: comment is on, so this job needs `pull-requests: write`. That is the only write ' +
      'permission Marlo uses.',
  );
}

if (problems.length > 0) {
  console.error('marlo: refusing to run.\n');
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error(
    'The scopes Marlo needs:\n\n' +
      '  permissions:\n' +
      '    contents: read\n' +
      '    pull-requests: write   # only if comment: true\n' +
      '    security-events: write # only if you upload the SARIF\n',
  );
  process.exitCode = 1;
} else if (checked) {
  console.log('marlo: token scopes checked against GITHUB_TOKEN_PERMISSIONS, nothing excessive.');
} else {
  // Not a pass. A missing signal reported as a pass is the failure mode this project exists
  // to argue against, so it says which check it could not perform.
  console.log(
    'marlo: GITHUB_TOKEN_PERMISSIONS is not set on this runner, so the token scopes could ' +
      'not be read and were NOT checked. Marlo still performs no write beyond an optional ' +
      'pull request comment, and you can verify that by reading the four files in this ' +
      'action directory.',
  );
}

void FORBIDDEN;
