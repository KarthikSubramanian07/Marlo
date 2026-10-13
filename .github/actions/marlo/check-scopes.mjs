#!/usr/bin/env node
/**
 * Refuses to run under a token that can do more than the chosen mode needs.
 *
 * WHY THIS EXISTS AS A SEPARATE STEP, FIRST
 *
 * Marlo promises it never merges, never pushes to a default branch, never force pushes, never
 * rewrites history and never deploys. In a GitHub Action that promise has nothing to do with
 * what the code does. Any step in a job with `contents: write` can push, and a reviewer
 * reading this action cannot tell whether it does without reading all of it.
 *
 * So the boundary is moved somewhere a reviewer can check in one line: the action refuses to
 * run at all if it was handed a permission the mode does not need. If somebody adds a push
 * step later, they have to also delete this check, and deleting it is a diff that says exactly
 * what it is doing.
 *
 * TWO MODES, AND THE CHECK SAYS WHICH ONE IT RAN
 *
 * Report only, the default: `contents: write` is refused, as it always was.
 *
 * Open a pull request, opt-in with `open-pull-request: true`: exactly `contents: write` and
 * `pull-requests: write` are required, the first to create a `marlo/` branch and commit to
 * it, the second to open the pull request. Holding less is refused, because the run would
 * fail halfway through a write. The scopes that reach past the repository's files are
 * refused in both modes: `workflows`, `administration`, `packages`, `pages`, `deployments`
 * and `id-token`.
 *
 * WHAT IT CAN AND CANNOT SEE
 *
 * GitHub does not expose the resolved permission set to a step. What it does expose is
 * GITHUB_TOKEN_PERMISSIONS on newer runners. The check uses that when it is present and says
 * so when it is not, rather than reporting a pass it did not earn.
 *
 * That honesty matters more here than a green tick: a scope check that silently degrades to
 * "no data, therefore fine" is exactly the class of defect HONESTY.md is about.
 */
import { pathToFileURL } from 'node:url';

/** Scopes that reach past the repository's files. Refused at any level other than none, in every mode. */
export const NEVER = [
  'workflows',
  'administration',
  'packages',
  'pages',
  'deployments',
  'id-token',
];

/** Permissions the report-only mode may hold, and the levels it accepts for each. */
const REPORT_ONLY = {
  contents: ['read', 'none'],
  'pull-requests': ['read', 'write', 'none'],
  checks: ['read', 'write', 'none'],
  'security-events': ['read', 'write', 'none'],
  actions: ['read', 'none'],
  metadata: ['read', 'none'],
  statuses: ['read', 'write', 'none'],
  issues: ['read', 'write', 'none'],
};

/** The pull request mode: the same, except the two scopes it writes with are required. */
const OPEN_PULL_REQUEST = {
  ...REPORT_ONLY,
  contents: ['write'],
  'pull-requests': ['write'],
};

/** Characters of an unparseable permissions value echoed back. */
const ECHO_LIMIT = 200;

/**
 * The scope check as a function of its inputs, so it can be tested without a runner.
 *
 * @param {{ permissions: string, openPullRequest: boolean }} input
 *   `permissions` is the raw GITHUB_TOKEN_PERMISSIONS value, empty when the runner did not set it.
 * @returns {{ mode: 'report-only' | 'open-pull-request', checked: boolean, problems: string[] }}
 */
export function checkScopes({ permissions, openPullRequest }) {
  const mode = openPullRequest ? 'open-pull-request' : 'report-only';
  const allowedFor = openPullRequest ? OPEN_PULL_REQUEST : REPORT_ONLY;
  const problems = [];

  if (permissions.trim() === '') return { mode, checked: false, problems };

  let parsed;
  try {
    parsed = JSON.parse(permissions);
  } catch {
    parsed = null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    problems.push(
      'GITHUB_TOKEN_PERMISSIONS was set and did not parse as a JSON object, so the scopes ' +
        `could not be checked: ${permissions.slice(0, ECHO_LIMIT)}`,
    );
    return { mode, checked: true, problems };
  }

  const level = (scope) => String(parsed[scope] ?? 'none');

  for (const [scope, value] of Object.entries(parsed)) {
    const granted = String(value);
    // `contents` and `pull-requests` get their own messages below, which say why.
    if (scope === 'contents' || scope === 'pull-requests') continue;
    if (NEVER.includes(scope)) {
      if (granted !== 'none') {
        problems.push(
          `the job grants \`${scope}: ${granted}\`. Marlo refuses it in every mode: it reaches ` +
            'past the files Marlo edits, and nothing Marlo does needs it.',
        );
      }
      continue;
    }
    const allowed = allowedFor[scope];
    if (allowed === undefined) {
      problems.push(
        `the job grants \`${scope}: ${granted}\`, which this action has no use for. ` +
          'Marlo asks for the narrowest set that does the work, and an unused scope is a ' +
          'capability nobody is watching.',
      );
      continue;
    }
    if (!allowed.includes(granted)) {
      problems.push(
        `the job grants \`${scope}: ${granted}\`. Marlo will not run with it. ` +
          `Permitted: ${allowed.join(', ')}.`,
      );
    }
  }

  if (openPullRequest) {
    if (level('contents') !== 'write') {
      problems.push(
        `open-pull-request is on and the job grants \`contents: ${level('contents')}\`. ` +
          'Opening a pull request means creating a `marlo/` branch and committing to it, which ' +
          'needs `contents: write`. Grant it, or turn open-pull-request off.',
      );
    }
    if (level('pull-requests') !== 'write') {
      problems.push(
        `open-pull-request is on and the job grants \`pull-requests: ${level('pull-requests')}\`. ` +
          'Opening the pull request needs `pull-requests: write`.',
      );
    }
  } else {
    if (level('contents') === 'write') {
      problems.push(
        'the job grants `contents: write`. With open-pull-request off, Marlo never commits, ' +
          'pushes, force pushes, rewrites history or deploys, so it does not need that ' +
          'permission and will not accept it. Use `contents: read`.',
      );
    } else if (!REPORT_ONLY.contents.includes(level('contents'))) {
      problems.push(`the job grants \`contents: ${level('contents')}\`. Use \`contents: read\`.`);
    }
    if (!REPORT_ONLY['pull-requests'].includes(level('pull-requests'))) {
      problems.push(
        `the job grants \`pull-requests: ${level('pull-requests')}\`. Permitted: read, write, none.`,
      );
    }
  }

  return { mode, checked: true, problems };
}

/** What the scopes for a mode look like, printed under a refusal. */
export function requiredScopes(openPullRequest) {
  return openPullRequest
    ? '  permissions:\n' +
        '    contents: write        # create the marlo/ branch and commit the fixes to it\n' +
        '    pull-requests: write   # open the pull request\n'
    : '  permissions:\n' +
        '    contents: read\n' +
        '    pull-requests: write   # only if comment: true\n' +
        '    security-events: write # only if you upload the SARIF\n';
}

function main() {
  const openPullRequest = process.env['MARLO_OPEN_PULL_REQUEST'] === 'true';
  const { mode, checked, problems } = checkScopes({
    permissions: process.env['GITHUB_TOKEN_PERMISSIONS'] ?? '',
    openPullRequest,
  });

  console.log(`marlo: checking token scopes for the ${mode} mode.`);

  if (!openPullRequest && process.env['MARLO_COMMENT'] === 'true') {
    console.log(
      'marlo: comment is on, so this job needs `pull-requests: write`. In the report-only ' +
        'mode that is the only write permission Marlo uses.',
    );
  }

  if (problems.length > 0) {
    console.error(`marlo: refusing to run in the ${mode} mode.\n`);
    for (const problem of problems) console.error(`  ${problem}\n`);
    console.error(`The scopes Marlo needs in this mode:\n\n${requiredScopes(openPullRequest)}`);
    process.exitCode = 1;
  } else if (checked) {
    console.log(
      `marlo: token scopes checked against GITHUB_TOKEN_PERMISSIONS for the ${mode} mode, ` +
        'nothing excessive and nothing missing.',
    );
  } else {
    // Not a pass. A missing signal reported as a pass is the failure mode this project exists
    // to argue against, so it says which check it could not perform.
    console.log(
      `marlo: GITHUB_TOKEN_PERMISSIONS is not set on this runner, so the token scopes for the ${mode} ` +
        'mode could not be read and were NOT checked. ' +
        (openPullRequest
          ? 'The pull request client still refuses to write to any branch outside marlo/, to ' +
            'the default branch, or with a forced ref update.'
          : 'Marlo still performs no write beyond an optional pull request comment, and you ' +
            'can verify that by reading the files in this action directory.'),
    );
  }
}

// Run only when executed, so the test can import checkScopes without side effects.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
