import type { PlannedFile, PullRequestPlan } from './pull-request.js';

/**
 * The GitHub boundary: the only place in Marlo that talks to a repository host.
 *
 * It is an interface with two implementations, a REST client over `fetch` and an in-memory
 * fake, and the opener below is written against the interface so its behaviour is tested
 * without a network. The interface is deliberately small and has no method that merges,
 * deletes, force-updates or touches a workflow file, so those operations are not reachable
 * from the fix path however it is called (DECISIONS.md D-011).
 *
 * Nothing here shells out. The earlier Action step that posted a comment ran `gh`, which is
 * fine for a comment; a commit needs the Git data API and that is a handful of JSON calls,
 * each with an encoded path segment and a JSON body, and no string ever reaches a shell.
 */

export interface PullRequestRef {
  readonly number: number;
  readonly url: string;
}

export interface CommitAuthor {
  readonly name: string;
  readonly email: string;
}

export interface GitHubClient {
  /** The repository's default branch, read from the API rather than assumed. */
  defaultBranch(): Promise<string>;
  /** The commit a branch points at, or null when there is no such branch. */
  branchSha(name: string): Promise<string | null>;
  branchExists(name: string): Promise<boolean>;
  /** Open pull requests whose head is `head`, in this repository. */
  openPullRequests(head: string): Promise<readonly PullRequestRef[]>;
  /** Creates `refs/heads/<name>` at `fromSha`. Fails if it exists; never moves an existing ref. */
  createBranch(name: string, fromSha: string): Promise<void>;
  /**
   * One commit on `branch` containing `files`, fast-forward only. Returns the commit sha.
   * The ref update is never forced: if the branch moved since it was created, this fails.
   */
  commitFiles(
    branch: string,
    files: readonly PlannedFile[],
    message: string,
    author: CommitAuthor,
  ): Promise<string>;
  openPullRequest(input: {
    readonly head: string;
    readonly base: string;
    readonly title: string;
    readonly body: string;
  }): Promise<PullRequestRef>;
}

/** Every ref Marlo creates lives under this prefix. The client refuses any other. */
export const BRANCH_PREFIX = 'marlo/';

/** The identity on the commit when the workflow does not supply one. */
export const DEFAULT_COMMIT_AUTHOR: CommitAuthor = Object.freeze({
  name: 'marlo[bot]',
  email: 'marlo-bot@users.noreply.github.com',
});

/** Bytes of an error body kept in the message. The rest is noise and may contain page content. */
const ERROR_BODY_LIMIT = 500;

export class GitHubApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;

  constructor(status: number, method: string, path: string, body: string) {
    super(`${method} ${path} returned ${String(status)}: ${body.slice(0, ERROR_BODY_LIMIT)}`);
    this.name = 'GitHubApiError';
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedError';
  }
}

/** The refusal for a branch outside the prefix, or null when the name is one Marlo may write. */
function outsidePrefix(name: string): RefusedError | null {
  if (name.startsWith(BRANCH_PREFIX) && name.length > BRANCH_PREFIX.length) return null;
  return new RefusedError(
    `refusing to write to "${name}". Marlo only ever writes to a branch under ` +
      `${BRANCH_PREFIX}, which is how it cannot push to yours.`,
  );
}

function assertMarloBranch(name: string): void {
  const refusal = outsidePrefix(name);
  if (refusal !== null) throw refusal;
}

/* ── The REST implementation ──────────────────────────────────────────────────── */

/** The subset of `fetch` the client uses, so a test can hand in a recorder. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface GitHubClientOptions {
  readonly owner: string;
  readonly repo: string;
  readonly token: string;
  readonly fetch?: FetchLike;
  readonly apiBase?: string;
}

const seg = (s: string): string => encodeURIComponent(s);

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const apiBase = (options.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
  const doFetch: FetchLike =
    options.fetch ??
    (async (url, init) => {
      const response = await fetch(url, init);
      return { status: response.status, text: async () => await response.text() };
    });
  const repoPath = `/repos/${seg(options.owner)}/${seg(options.repo)}`;

  async function call(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${options.token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'marlo',
    };
    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method,
      headers,
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await doFetch(`${apiBase}${path}`, init);
    const text = await response.text();
    if (response.status === 404 && method === 'GET') return { status: 404, json: null };
    if (response.status < 200 || response.status >= 300) {
      throw new GitHubApiError(response.status, method, path, text);
    }
    return { status: response.status, json: text === '' ? null : (JSON.parse(text) as unknown) };
  }

  function field(json: unknown, name: string): unknown {
    return typeof json === 'object' && json !== null ? Reflect.get(json, name) : undefined;
  }

  function str(json: unknown, name: string, where: string): string {
    const value = field(json, name);
    if (typeof value !== 'string' || value === '') {
      throw new GitHubApiError(200, 'GET', where, `response had no string ${name}`);
    }
    return value;
  }

  const client: GitHubClient = {
    async defaultBranch() {
      const { json } = await call('GET', repoPath);
      return str(json, 'default_branch', repoPath);
    },

    async branchSha(name) {
      const path = `${repoPath}/git/ref/${seg('heads')}/${name.split('/').map(seg).join('/')}`;
      const { status, json } = await call('GET', path);
      if (status === 404) return null;
      return str(field(json, 'object'), 'sha', path);
    },

    async branchExists(name) {
      return (await client.branchSha(name)) !== null;
    },

    async openPullRequests(head) {
      const path =
        `${repoPath}/pulls?state=open&per_page=100&head=` + seg(`${options.owner}:${head}`);
      const { json } = await call('GET', path);
      if (!Array.isArray(json)) return [];
      return json.map((pull: unknown) => ({
        number: Number(field(pull, 'number')),
        url: str(pull, 'html_url', path),
      }));
    },

    async createBranch(name, fromSha) {
      assertMarloBranch(name);
      await call('POST', `${repoPath}/git/refs`, { ref: `refs/heads/${name}`, sha: fromSha });
    },

    async commitFiles(branch, files, message, author) {
      assertMarloBranch(branch);
      const parent = await client.branchSha(branch);
      if (parent === null) {
        throw new RefusedError(`cannot commit to "${branch}": the branch does not exist.`);
      }
      const commitPath = `${repoPath}/git/commits/${seg(parent)}`;
      const parentCommit = await call('GET', commitPath);
      const baseTree = str(field(parentCommit.json, 'tree'), 'sha', commitPath);

      const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
      for (const file of files) {
        const blob = await call('POST', `${repoPath}/git/blobs`, {
          content: file.contents,
          encoding: 'utf-8',
        });
        tree.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: str(blob.json, 'sha', `${repoPath}/git/blobs`),
        });
      }
      const newTree = await call('POST', `${repoPath}/git/trees`, { base_tree: baseTree, tree });
      const commit = await call('POST', `${repoPath}/git/commits`, {
        message,
        tree: str(newTree.json, 'sha', `${repoPath}/git/trees`),
        parents: [parent],
        author: { name: author.name, email: author.email },
      });
      const sha = str(commit.json, 'sha', `${repoPath}/git/commits`);
      // `force: false` is the default and is spelled out anyway, because this is the one
      // call in the codebase that moves a ref and the reader should not have to look it up.
      await call(
        'PATCH',
        `${repoPath}/git/refs/${seg('heads')}/${branch.split('/').map(seg).join('/')}`,
        { sha, force: false },
      );
      return sha;
    },

    async openPullRequest(input) {
      const path = `${repoPath}/pulls`;
      const { json } = await call('POST', path, {
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body,
        maintainer_can_modify: true,
      });
      return { number: Number(field(json, 'number')), url: str(json, 'html_url', path) };
    },
  };
  return client;
}

/* ── The in-memory fake ───────────────────────────────────────────────────────── */

export interface FakeRepository {
  defaultBranch: string;
  /** Branch name to commit sha. */
  branches: Map<string, string>;
  /** Branch name to the files committed on it. */
  files: Map<string, readonly PlannedFile[]>;
  commits: { branch: string; sha: string; message: string; author: CommitAuthor }[];
  pulls: { number: number; head: string; base: string; title: string; body: string; url: string }[];
  /** Every write, in order. Reads are not recorded; the point is to see what changed. */
  writes: string[];
}

/** Implements the same interface over memory, for the opener's tests. */
export class InMemoryGitHub implements GitHubClient {
  readonly state: FakeRepository;
  private counter = 0;

  constructor(defaultBranch = 'main', defaultSha = 'a'.repeat(40)) {
    this.state = {
      defaultBranch,
      branches: new Map([[defaultBranch, defaultSha]]),
      files: new Map(),
      commits: [],
      pulls: [],
      writes: [],
    };
  }

  private nextSha(): string {
    this.counter += 1;
    return this.counter.toString(16).padStart(40, '0');
  }

  defaultBranch(): Promise<string> {
    return Promise.resolve(this.state.defaultBranch);
  }

  branchSha(name: string): Promise<string | null> {
    return Promise.resolve(this.state.branches.get(name) ?? null);
  }

  async branchExists(name: string): Promise<boolean> {
    return (await this.branchSha(name)) !== null;
  }

  openPullRequests(head: string): Promise<readonly PullRequestRef[]> {
    return Promise.resolve(
      this.state.pulls
        .filter((p) => p.head === head)
        .map((p) => ({ number: p.number, url: p.url })),
    );
  }

  createBranch(name: string, fromSha: string): Promise<void> {
    const refusal = outsidePrefix(name);
    if (refusal !== null) return Promise.reject(refusal);
    if (this.state.branches.has(name)) {
      return Promise.reject(
        new GitHubApiError(422, 'POST', '/git/refs', 'Reference already exists'),
      );
    }
    this.state.branches.set(name, fromSha);
    this.state.writes.push(`createBranch ${name}`);
    return Promise.resolve();
  }

  commitFiles(
    branch: string,
    files: readonly PlannedFile[],
    message: string,
    author: CommitAuthor,
  ): Promise<string> {
    const refusal = outsidePrefix(branch);
    if (refusal !== null) return Promise.reject(refusal);
    if (!this.state.branches.has(branch)) {
      return Promise.reject(
        new RefusedError(`cannot commit to "${branch}": the branch does not exist.`),
      );
    }
    const sha = this.nextSha();
    this.state.branches.set(branch, sha);
    this.state.files.set(branch, files);
    this.state.commits.push({ branch, sha, message, author });
    this.state.writes.push(`commit ${branch} ${String(files.length)} file(s)`);
    return Promise.resolve(sha);
  }

  openPullRequest(input: {
    readonly head: string;
    readonly base: string;
    readonly title: string;
    readonly body: string;
  }): Promise<PullRequestRef> {
    const number = this.state.pulls.length + 1;
    const url = `https://github.example/pull/${String(number)}`;
    this.state.pulls.push({ number, url, ...input });
    this.state.writes.push(`openPullRequest ${input.head} -> ${input.base}`);
    return Promise.resolve({ number, url });
  }
}

/* ── The opener ───────────────────────────────────────────────────────────────── */

export interface OpenOptions {
  /** The branch the pull request targets. Defaults to the repository's default branch. */
  readonly base?: string;
  readonly author?: CommitAuthor;
}

export type OpenResult =
  | {
      readonly kind: 'opened';
      readonly branch: string;
      readonly commitSha: string;
      readonly pull: PullRequestRef;
    }
  | { readonly kind: 'already-open'; readonly branch: string; readonly pull: PullRequestRef }
  | { readonly kind: 'branch-exists'; readonly branch: string }
  | { readonly kind: 'nothing-to-open'; readonly reason: string }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Opens the pull request a plan describes, once.
 *
 * Reads as a sequence of refusals, like `repairFinding`. The checks that make the pipeline
 * idempotent come before any write: an open pull request from this branch, or the branch
 * itself, means the work was done and this run does nothing. The checks that keep the
 * boundary come before those: the base is read from the API, and a plan whose branch is the
 * default branch, or equal to the base, is refused before anything is looked up.
 */
export async function openPlannedPullRequest(
  client: GitHubClient,
  plan: PullRequestPlan,
  options: OpenOptions = {},
): Promise<OpenResult> {
  if (plan.kind === 'nothing-to-open') return { kind: 'nothing-to-open', reason: plan.reason };

  const defaultBranch = await client.defaultBranch();
  const base = options.base ?? defaultBranch;
  const { branch } = plan;

  if (!branch.startsWith(BRANCH_PREFIX)) {
    return {
      kind: 'refused',
      reason: `the plan's branch "${branch}" is not under ${BRANCH_PREFIX}.`,
    };
  }
  if (branch === defaultBranch) {
    return {
      kind: 'refused',
      reason: `the plan's branch is the default branch "${defaultBranch}".`,
    };
  }
  if (branch === base) {
    return { kind: 'refused', reason: `head and base are both "${base}".` };
  }

  const open = await client.openPullRequests(branch);
  const existing = open[0];
  if (existing !== undefined) return { kind: 'already-open', branch, pull: existing };
  if (await client.branchExists(branch)) return { kind: 'branch-exists', branch };

  const baseSha = await client.branchSha(base);
  if (baseSha === null) {
    return { kind: 'refused', reason: `the base branch "${base}" does not exist.` };
  }

  await client.createBranch(branch, baseSha);
  const commitSha = await client.commitFiles(
    branch,
    plan.files,
    plan.commitMessage,
    options.author ?? DEFAULT_COMMIT_AUTHOR,
  );
  const pull = await client.openPullRequest({
    head: branch,
    base,
    title: plan.title,
    body: plan.body,
  });
  return { kind: 'opened', branch, commitSha, pull };
}
