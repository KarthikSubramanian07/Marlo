import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRANCH_PREFIX,
  DEFAULT_COMMIT_AUTHOR,
  GitHubApiError,
  InMemoryGitHub,
  RefusedError,
  createGitHubClient,
  openPlannedPullRequest,
  type FetchLike,
} from './github.js';
import type { PullRequestPlan } from './pull-request.js';

/**
 * The opener is tested against the in-memory fake, and the REST client against a recorded
 * `fetch`. Between them: the first run opens one pull request, the second run over the same
 * state writes nothing, the boundary refuses what D-011 says it refuses, and the one call
 * that moves a ref never forces.
 */

const plan: PullRequestPlan = {
  kind: 'plan',
  branch: 'marlo/fix-0123456789ab',
  title: 'Fix 1 verified accessibility violation in 1 file',
  body: 'The body.\n',
  commitMessage: 'a11y: apply 1 verified accessibility fix across 1 file\n',
  files: [{ path: 'apps/demo/checkout.html', contents: '<p>fixed</p>' }],
  summary: {
    fixesApplied: 1,
    fixesRefused: 0,
    filesChanged: 1,
    filesExcluded: [],
    fixesDeferred: 0,
    flagsOmitted: 0,
  },
};

describe('the opener, against the fake', () => {
  it('opens exactly one pull request on the first run', async () => {
    const github = new InMemoryGitHub('main', 'b'.repeat(40));
    const result = await openPlannedPullRequest(github, plan);
    expect(result.kind).toBe('opened');
    if (result.kind !== 'opened') return;
    expect(result.pull.number).toBe(1);
    expect(github.state.writes).toEqual([
      'createBranch marlo/fix-0123456789ab',
      'commit marlo/fix-0123456789ab 1 file(s)',
      'openPullRequest marlo/fix-0123456789ab -> main',
    ]);
    // The default branch did not move, and the files landed on the new branch only.
    expect(github.state.branches.get('main')).toBe('b'.repeat(40));
    expect(github.state.files.get('marlo/fix-0123456789ab')).toEqual(plan.files);
    expect(github.state.files.has('main')).toBe(false);
    // Authored as the bot unless told otherwise.
    expect(github.state.commits[0]?.author).toEqual(DEFAULT_COMMIT_AUTHOR);
    expect(github.state.commits[0]?.message).toBe(plan.commitMessage);
    expect(github.state.pulls[0]).toMatchObject({
      head: plan.branch,
      base: 'main',
      title: plan.title,
    });
  });

  it('opens nothing and edits nothing on a second run over the same state', async () => {
    // The idempotence claim, as a test rather than as two manual runs. The plan is the
    // same because the content is the same, so the branch name is the same, so the open
    // pull request is found and the run stops before its first write.
    const github = new InMemoryGitHub();
    await openPlannedPullRequest(github, plan);
    const before = JSON.stringify([...github.state.branches], null, 0) + github.state.writes.join();

    const second = await openPlannedPullRequest(github, plan);
    expect(second.kind).toBe('already-open');
    if (second.kind !== 'already-open') return;
    expect(second.pull.number).toBe(1);
    expect(github.state.pulls).toHaveLength(1);
    expect(github.state.commits).toHaveLength(1);
    expect(JSON.stringify([...github.state.branches], null, 0) + github.state.writes.join()).toBe(
      before,
    );
  });

  it('stops at an existing branch even when its pull request has been closed', async () => {
    // A closed pull request means a person said no. Reusing its branch would reopen the
    // argument; the branch is the record that the content was already offered.
    const github = new InMemoryGitHub();
    await github.createBranch(plan.branch, 'a'.repeat(40));
    github.state.writes.length = 0;
    const result = await openPlannedPullRequest(github, plan);
    expect(result).toEqual({ kind: 'branch-exists', branch: plan.branch });
    expect(github.state.writes).toEqual([]);
    expect(github.state.pulls).toEqual([]);
  });

  it('uses the author the workflow supplied', async () => {
    const github = new InMemoryGitHub();
    const author = { name: 'Release Bot', email: 'release@example.com' };
    await openPlannedPullRequest(github, plan, { author });
    expect(github.state.commits[0]?.author).toEqual(author);
  });

  it('targets the base it was given, and otherwise the default branch', async () => {
    const github = new InMemoryGitHub('develop');
    github.state.branches.set('release', 'c'.repeat(40));
    const onRelease = await openPlannedPullRequest(github, plan, { base: 'release' });
    expect(onRelease.kind).toBe('opened');
    expect(github.state.pulls[0]?.base).toBe('release');
    expect(github.state.branches.get(plan.branch)).not.toBe('c'.repeat(40));
    expect(github.state.commits[0]?.sha).toBe(github.state.branches.get(plan.branch));
  });

  it('refuses a head equal to the base', async () => {
    const github = new InMemoryGitHub();
    github.state.branches.set(plan.branch, 'd'.repeat(40));
    const result = await openPlannedPullRequest(github, plan, { base: plan.branch });
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toContain('head and base are both');
    expect(github.state.writes).toEqual([]);
  });

  it('refuses to push to the default branch, which it reads from the API', async () => {
    const github = new InMemoryGitHub(plan.branch);
    const result = await openPlannedPullRequest(github, plan);
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toContain('default branch');
    expect(github.state.writes).toEqual([]);
  });

  it('refuses a plan whose branch is not under the marlo prefix', async () => {
    const github = new InMemoryGitHub();
    const result = await openPlannedPullRequest(github, { ...plan, branch: 'feature/x' });
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toContain(BRANCH_PREFIX);
    expect(github.state.writes).toEqual([]);
  });

  it('refuses a base that does not exist rather than creating it', async () => {
    const github = new InMemoryGitHub();
    const result = await openPlannedPullRequest(github, plan, { base: 'nope' });
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toContain('"nope" does not exist');
    expect(github.state.branches.has('nope')).toBe(false);
  });

  it('passes a nothing-to-open plan through without touching the repository', async () => {
    const github = new InMemoryGitHub();
    const result = await openPlannedPullRequest(github, {
      kind: 'nothing-to-open',
      reason: 'no findings',
      summary: plan.summary,
    });
    expect(result).toEqual({ kind: 'nothing-to-open', reason: 'no findings' });
    expect(github.state.writes).toEqual([]);
  });

  it('is a fake that refuses the same things the real client refuses', async () => {
    const github = new InMemoryGitHub();
    await expect(github.createBranch('main', 'a'.repeat(40))).rejects.toBeInstanceOf(RefusedError);
    await expect(github.commitFiles('marlo/', [], 'm', DEFAULT_COMMIT_AUTHOR)).rejects.toThrow(
      RefusedError,
    );
    await expect(
      github.commitFiles('marlo/missing', [], 'm', DEFAULT_COMMIT_AUTHOR),
    ).rejects.toThrow(/does not exist/);
    await github.createBranch(plan.branch, 'a'.repeat(40));
    await expect(github.createBranch(plan.branch, 'a'.repeat(40))).rejects.toBeInstanceOf(
      GitHubApiError,
    );
  });
});

/* ── The REST client ──────────────────────────────────────────────────────────── */

interface Recorded {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** A fetch that answers from a script keyed by `METHOD path` and records every call. */
function recorder(script: Record<string, { status?: number; json?: unknown; text?: string }>) {
  const calls: Recorded[] = [];
  const fetchLike: FetchLike = (url, init) => {
    const path = url.replace('https://api.github.com', '');
    calls.push({
      method: init.method,
      url: path,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      headers: init.headers,
    });
    const key = `${init.method} ${path}`;
    const answer = script[key];
    if (answer === undefined) {
      return Promise.resolve({
        status: 404,
        text: () => Promise.resolve('{"message":"Not Found"}'),
      });
    }
    return Promise.resolve({
      status: answer.status ?? 200,
      text: () => Promise.resolve(answer.text ?? JSON.stringify(answer.json ?? null)),
    });
  };
  return { calls, fetch: fetchLike };
}

const repo = '/repos/acme/web%20site';
const options = { owner: 'acme', repo: 'web site', token: 'ghs_test' };

describe('the REST client', () => {
  it('reads the default branch from the repository, not from an assumption', async () => {
    const { calls, fetch } = recorder({ [`GET ${repo}`]: { json: { default_branch: 'trunk' } } });
    const client = createGitHubClient({ ...options, fetch });
    expect(await client.defaultBranch()).toBe('trunk');
    expect(calls[0]?.headers['authorization']).toBe('Bearer ghs_test');
    expect(calls[0]?.headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('reports a missing branch as null and an existing one by its sha', async () => {
    const { calls, fetch } = recorder({
      [`GET ${repo}/git/ref/heads/marlo/fix-0123456789ab`]: {
        json: { object: { sha: 'e'.repeat(40) } },
      },
    });
    const client = createGitHubClient({ ...options, fetch });
    expect(await client.branchSha('marlo/fix-0123456789ab')).toBe('e'.repeat(40));
    expect(await client.branchExists('marlo/fix-0123456789ab')).toBe(true);
    expect(await client.branchSha('marlo/absent')).toBeNull();
    expect(await client.branchExists('marlo/absent')).toBe(false);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('asks for open pull requests from exactly this head', async () => {
    const { calls, fetch } = recorder({
      [`GET ${repo}/pulls?state=open&per_page=100&head=acme%3Amarlo%2Ffix-0123456789ab`]: {
        json: [{ number: 7, html_url: 'https://github.com/acme/web%20site/pull/7' }],
      },
    });
    const client = createGitHubClient({ ...options, fetch });
    expect(await client.openPullRequests('marlo/fix-0123456789ab')).toEqual([
      { number: 7, url: 'https://github.com/acme/web%20site/pull/7' },
    ]);
    expect(calls).toHaveLength(1);
    // A non-array answer is no pull requests, not a crash.
    const odd = createGitHubClient({
      ...options,
      fetch: recorder({ [`GET ${repo}/pulls?state=open&per_page=100&head=acme%3Ax`]: { json: {} } })
        .fetch,
    });
    expect(await odd.openPullRequests('x')).toEqual([]);
  });

  it('creates a branch as a new ref and never for a name outside the prefix', async () => {
    const { calls, fetch } = recorder({ [`POST ${repo}/git/refs`]: { status: 201, json: {} } });
    const client = createGitHubClient({ ...options, fetch });
    await client.createBranch('marlo/fix-0123456789ab', 'f'.repeat(40));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `${repo}/git/refs`,
      body: { ref: 'refs/heads/marlo/fix-0123456789ab', sha: 'f'.repeat(40) },
    });
    await expect(client.createBranch('main', 'f'.repeat(40))).rejects.toBeInstanceOf(RefusedError);
    await expect(client.createBranch('marlo/', 'f'.repeat(40))).rejects.toBeInstanceOf(
      RefusedError,
    );
    expect(calls).toHaveLength(1);
  });

  it('commits through the Git data API and updates the ref without force', async () => {
    const branch = 'marlo/fix-0123456789ab';
    const parent = '1'.repeat(40);
    const { calls, fetch } = recorder({
      [`GET ${repo}/git/ref/heads/${branch}`]: { json: { object: { sha: parent } } },
      [`GET ${repo}/git/commits/${parent}`]: { json: { tree: { sha: 'tree0' } } },
      [`POST ${repo}/git/blobs`]: { status: 201, json: { sha: 'blob1' } },
      [`POST ${repo}/git/trees`]: { status: 201, json: { sha: 'tree1' } },
      [`POST ${repo}/git/commits`]: { status: 201, json: { sha: 'commit1' } },
      [`PATCH ${repo}/git/refs/heads/${branch}`]: { json: { object: { sha: 'commit1' } } },
    });
    const client = createGitHubClient({ ...options, fetch });
    const author = { name: 'marlo[bot]', email: 'marlo-bot@users.noreply.github.com' };
    const sha = await client.commitFiles(
      branch,
      [
        { path: 'a.html', contents: '<p>a</p>' },
        { path: 'dir/b.html', contents: '<p>b</p>' },
      ],
      'a11y: apply 2 verified accessibility fixes across 2 files\n',
      author,
    );
    expect(sha).toBe('commit1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${repo}/git/ref/heads/${branch}`,
      `GET ${repo}/git/commits/${parent}`,
      `POST ${repo}/git/blobs`,
      `POST ${repo}/git/blobs`,
      `POST ${repo}/git/trees`,
      `POST ${repo}/git/commits`,
      `PATCH ${repo}/git/refs/heads/${branch}`,
    ]);
    expect(calls[2]?.body).toEqual({ content: '<p>a</p>', encoding: 'utf-8' });
    expect(calls[4]?.body).toEqual({
      base_tree: 'tree0',
      tree: [
        { path: 'a.html', mode: '100644', type: 'blob', sha: 'blob1' },
        { path: 'dir/b.html', mode: '100644', type: 'blob', sha: 'blob1' },
      ],
    });
    expect(calls[5]?.body).toEqual({
      message: 'a11y: apply 2 verified accessibility fixes across 2 files\n',
      tree: 'tree1',
      parents: [parent],
      author,
    });
    // The one ref update in the codebase, and it says force: false out loud.
    expect(calls[6]?.body).toEqual({ sha: 'commit1', force: false });
  });

  it('refuses to commit to a branch that does not exist or is not under the prefix', async () => {
    const { calls, fetch } = recorder({});
    const client = createGitHubClient({ ...options, fetch });
    await expect(
      client.commitFiles('marlo/absent', [], 'm', DEFAULT_COMMIT_AUTHOR),
    ).rejects.toThrow(/does not exist/);
    await expect(client.commitFiles('main', [], 'm', DEFAULT_COMMIT_AUTHOR)).rejects.toBeInstanceOf(
      RefusedError,
    );
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('opens the pull request and returns its number and url', async () => {
    const { calls, fetch } = recorder({
      [`POST ${repo}/pulls`]: {
        status: 201,
        json: { number: 12, html_url: 'https://github.com/acme/web%20site/pull/12' },
      },
    });
    const client = createGitHubClient({ ...options, fetch });
    const pull = await client.openPullRequest({
      head: 'marlo/fix-0123456789ab',
      base: 'main',
      title: 'Fix 1 verified accessibility violation in 1 file',
      body: 'The body.',
    });
    expect(pull).toEqual({ number: 12, url: 'https://github.com/acme/web%20site/pull/12' });
    expect(calls[0]?.body).toMatchObject({
      head: 'marlo/fix-0123456789ab',
      base: 'main',
      maintainer_can_modify: true,
    });
  });

  it('turns a non-2xx answer into an error carrying the status and a bounded body', async () => {
    const { fetch } = recorder({
      [`POST ${repo}/git/refs`]: { status: 403, text: 'x'.repeat(5000) },
    });
    const client = createGitHubClient({ ...options, fetch });
    const failure = await client
      .createBranch('marlo/fix-0123456789ab', 'a'.repeat(40))
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(GitHubApiError);
    if (!(failure instanceof GitHubApiError)) return;
    expect(failure.status).toBe(403);
    expect(failure.method).toBe('POST');
    expect(failure.message.length).toBeLessThan(700);
  });

  it('refuses an answer that lacks the field it needs rather than carrying on with undefined', async () => {
    const { fetch } = recorder({ [`GET ${repo}`]: { json: { name: 'web site' } } });
    const client = createGitHubClient({ ...options, fetch });
    await expect(client.defaultBranch()).rejects.toThrow(/no string default_branch/);
  });

  it('strips a trailing slash from a custom API base', async () => {
    const { calls, fetch } = recorder({});
    const client = createGitHubClient({
      ...options,
      fetch: (url, init) =>
        fetch(url.replace('https://ghe.example/api/v3', 'https://api.github.com'), init),
      apiBase: 'https://ghe.example/api/v3/',
    });
    await client.branchSha('marlo/x');
    expect(calls[0]?.url).toBe(`${repo}/git/ref/heads/marlo/x`);
  });

  it('answers an empty 2xx body as null rather than failing to parse it', async () => {
    const { fetch } = recorder({ [`POST ${repo}/git/refs`]: { status: 201, text: '' } });
    const client = createGitHubClient({ ...options, fetch });
    await expect(
      client.createBranch('marlo/fix-0123456789ab', 'a'.repeat(40)),
    ).resolves.toBeUndefined();
  });
});

/* ── The boundary, as an inventory ────────────────────────────────────────────── */

describe('the boundary D-011 promises', () => {
  // Written as a list of forbidden operations rather than permitted ones, so a new
  // capability has to be added here deliberately. SECURITY.md points at this test.
  const sources = readdirSync(import.meta.dirname)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => [f, readFileSync(resolve(import.meta.dirname, f), 'utf8')] as const);

  it('contains no merge, no force, no delete and no shell in the repair package', () => {
    for (const [name, text] of sources) {
      expect(text, `${name} reaches a merge endpoint`).not.toMatch(/\/merge\b/);
      expect(text, `${name} can force a ref`).not.toMatch(/force:\s*true/);
      expect(text, `${name} issues a DELETE`).not.toMatch(/['"]DELETE['"]/);
      expect(text, `${name} shells out`).not.toMatch(/child_process/);
      expect(text, `${name} touches a workflow`).not.toMatch(/\.github\/workflows/);
    }
  });

  it('exposes no method on the client that could merge, delete or force', () => {
    const client = new InMemoryGitHub();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client) as object).sort();
    expect(methods).toEqual([
      'branchExists',
      'branchSha',
      'commitFiles',
      'constructor',
      'createBranch',
      'defaultBranch',
      'nextSha',
      'openPullRequest',
      'openPullRequests',
    ]);
  });
});
