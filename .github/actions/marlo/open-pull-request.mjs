#!/usr/bin/env node
/**
 * Runs `marlo fix --json` over the resolved targets, plans a pull request from the result and
 * opens it through the GitHub client. Only reached when `open-pull-request: true`, and only
 * after check-scopes.mjs has accepted the token for that mode.
 *
 * Every decision is made elsewhere and tested there. The planner in @marlo/repair decides what
 * the pull request contains and is pure; the client in the same package is the only code that
 * talks to GitHub, over the REST API with `fetch`, and it refuses any branch outside `marlo/`,
 * the default branch, a head equal to its base, and a forced ref update. This file wires them
 * together and writes the outputs. It runs no git command and builds no shell string: the CLI
 * is started with execFileSync and an argument array.
 *
 * Idempotent by construction: the branch name is a hash of the edits, so a second run over
 * the same repository state finds the branch or its open pull request and writes nothing.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const load = async (path) => await import(pathToFileURL(resolve(ROOT, path)).href);

const { CalibrationTable, FixReport } = await load('packages/schema/dist/index.js');
const {
  DEFAULT_COMMIT_AUTHOR,
  MAX_FILES_SCANNED,
  createGitHubClient,
  openPlannedPullRequest,
  planPullRequest,
} = await load('packages/repair/dist/index.js');

const targets = (process.env['MARLO_TARGETS'] ?? '').split(' ').filter((t) => t !== '');
const base = (process.env['MARLO_PULL_REQUEST_BASE'] ?? '').trim();
const authorName = (process.env['MARLO_GIT_AUTHOR_NAME'] ?? '').trim();
const authorEmail = (process.env['MARLO_GIT_AUTHOR_EMAIL'] ?? '').trim();
const token = process.env['GITHUB_TOKEN'] ?? '';
const repository = process.env['GITHUB_REPOSITORY'] ?? '';

function output(key, value) {
  const path = process.env['GITHUB_OUTPUT'];
  if (path === undefined) {
    console.log(`${key}=${value}`);
    return;
  }
  appendFileSync(path, `${key}=${value}\n`, 'utf8');
}

function summary(markdown) {
  const path = process.env['GITHUB_STEP_SUMMARY'];
  if (path !== undefined) appendFileSync(path, `${markdown}\n`, 'utf8');
}

/** The three outputs, written once at the end so every path reports all of them. */
const result = { url: '', applied: 0, refused: 0 };

function stop(message) {
  console.error(`marlo: ${message}`);
  result.applied = 0;
  process.exitCode = 1;
}

async function main() {
  if (targets.length === 0) {
    console.log('marlo: no HTML files to fix, so no pull request was planned.');
    return;
  }
  // Checked before the CLI runs, not only by the planner: two thousand files is a long run
  // to spend before being told the answer was always going to be no.
  if (targets.length > MAX_FILES_SCANNED) {
    stop(
      `${String(targets.length)} files were resolved, over the cap of ${String(MAX_FILES_SCANNED)} ` +
        'for one pull request. Pass fewer with `files:`.',
    );
    return;
  }
  if (token === '' || !repository.includes('/')) {
    stop('GITHUB_TOKEN and GITHUB_REPOSITORY are both needed to open a pull request.');
    return;
  }
  if ((authorName === '') !== (authorEmail === '')) {
    stop('git-author-name and git-author-email are set together or not at all.');
    return;
  }

  // `marlo fix` exits 1 when it found something, which is the tool working. stdout is the
  // payload either way, so a non-zero exit with a report on stdout is read, not thrown.
  const bin = resolve(ROOT, 'packages/cli/dist/bin.js');
  let stdout;
  try {
    stdout = execFileSync('node', [bin, 'fix', ...targets, '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (error) {
    const e = /** @type {{ stdout?: string }} */ (error);
    if (typeof e.stdout !== 'string' || e.stdout.trim() === '') {
      stop(`marlo fix did not produce a report: ${String(error)}`);
      return;
    }
    stdout = e.stdout;
  }

  const report = FixReport.parse(JSON.parse(stdout));
  const table = CalibrationTable.parse(
    JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
  );
  const plan = planPullRequest({ reports: [report], table, marloVersion: report.marloVersion });
  result.applied = plan.summary.fixesApplied;
  result.refused = plan.summary.fixesRefused;

  const [owner, repo] = repository.split('/');
  const client = createGitHubClient({
    owner,
    repo,
    token,
    ...(process.env['GITHUB_API_URL'] ? { apiBase: process.env['GITHUB_API_URL'] } : {}),
  });
  const opened = await openPlannedPullRequest(client, plan, {
    ...(base === '' ? {} : { base }),
    author: authorName === '' ? DEFAULT_COMMIT_AUTHOR : { name: authorName, email: authorEmail },
  });

  switch (opened.kind) {
    case 'opened':
      result.url = opened.pull.url;
      console.log(`marlo: opened ${opened.pull.url} from ${opened.branch}.`);
      summary(
        `### Marlo opened a pull request\n\n${opened.pull.url}: ` +
          `${String(plan.summary.fixesApplied)} verified fix(es) applied, ` +
          `${String(plan.summary.fixesRefused)} refused and left for a person.`,
      );
      return;
    case 'already-open':
      result.url = opened.pull.url;
      console.log(
        `marlo: ${opened.pull.url} is already open from ${opened.branch} for this exact content. ` +
          'Nothing was written.',
      );
      return;
    case 'branch-exists':
      console.log(
        `marlo: the branch ${opened.branch} already exists, so this content was offered before ` +
          '(its pull request may have been closed). Nothing was written.',
      );
      return;
    case 'nothing-to-open':
      console.log(`marlo: no pull request to open: ${opened.reason}`);
      return;
    case 'refused':
      stop(`refusing to open a pull request: ${opened.reason}`);
      return;
  }
}

try {
  await main();
} catch (error) {
  stop(error instanceof Error ? error.message : String(error));
} finally {
  output('pull-request-url', result.url);
  output('fixes-applied', String(result.applied));
  output('fixes-refused', String(result.refused));
}
