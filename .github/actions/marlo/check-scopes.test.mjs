import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEVER, checkScopes } from './check-scopes.mjs';

/**
 * The scope check in both modes, as a function and as the step the Action runs.
 *
 * The case that matters most is the refusal of `open-pull-request: true` under
 * `contents: read`: CI's own Action job is read-only, so the pull request mode is never
 * exercised there against a real token, and this is where the refusal is proved instead.
 */

const SCRIPT = resolve(import.meta.dirname, 'check-scopes.mjs');
const perms = (o) => JSON.stringify(o);

function runStep(env) {
  const result = spawnSync('node', [SCRIPT], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'], ...env },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

describe('the report-only mode, which is the default', () => {
  it('accepts contents: read', () => {
    const r = checkScopes({ permissions: perms({ contents: 'read' }), openPullRequest: false });
    expect(r).toEqual({ mode: 'report-only', checked: true, problems: [] });
  });

  it('still refuses contents: write, exactly as before the pull request mode existed', () => {
    const r = checkScopes({
      permissions: perms({ contents: 'write', 'pull-requests': 'write' }),
      openPullRequest: false,
    });
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('`contents: write`');
    expect(r.problems[0]).toContain('Use `contents: read`');
  });

  it('accepts pull-requests: write for the optional comment', () => {
    const r = checkScopes({
      permissions: perms({ contents: 'read', 'pull-requests': 'write' }),
      openPullRequest: false,
    });
    expect(r.problems).toEqual([]);
  });

  it('refuses a scope it has no use for', () => {
    const r = checkScopes({
      permissions: perms({ contents: 'read', discussions: 'write' }),
      openPullRequest: false,
    });
    expect(r.problems[0]).toContain('no use for');
  });
});

describe('the open-pull-request mode', () => {
  it('accepts exactly contents: write and pull-requests: write', () => {
    const r = checkScopes({
      permissions: perms({ contents: 'write', 'pull-requests': 'write', metadata: 'read' }),
      openPullRequest: true,
    });
    expect(r).toEqual({ mode: 'open-pull-request', checked: true, problems: [] });
  });

  it('refuses to run under contents: read', () => {
    const r = checkScopes({
      permissions: perms({ contents: 'read', 'pull-requests': 'write' }),
      openPullRequest: true,
    });
    expect(r.mode).toBe('open-pull-request');
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('`contents: read`');
    expect(r.problems[0]).toContain('needs `contents: write`');
  });

  it('refuses to run without pull-requests: write', () => {
    const r = checkScopes({ permissions: perms({ contents: 'write' }), openPullRequest: true });
    expect(r.problems).toEqual([expect.stringContaining('`pull-requests: none`')]);
  });

  it('refuses every scope that reaches past the files, in both modes', () => {
    for (const openPullRequest of [true, false]) {
      for (const scope of NEVER) {
        const r = checkScopes({
          permissions: perms({
            contents: openPullRequest ? 'write' : 'read',
            'pull-requests': 'write',
            [scope]: 'write',
          }),
          openPullRequest,
        });
        expect(r.problems, `${scope} with openPullRequest=${String(openPullRequest)}`).toEqual([
          expect.stringContaining(`\`${scope}: write\``),
        ]);
      }
    }
    expect(NEVER).toEqual([
      'workflows',
      'administration',
      'packages',
      'pages',
      'deployments',
      'id-token',
    ]);
  });

  it('accepts one of those scopes explicitly set to none', () => {
    const r = checkScopes({
      permissions: perms({ contents: 'write', 'pull-requests': 'write', workflows: 'none' }),
      openPullRequest: true,
    });
    expect(r.problems).toEqual([]);
  });
});

describe('what it cannot see', () => {
  it('reports unchecked, not passed, when the runner sets no permissions', () => {
    const r = checkScopes({ permissions: '', openPullRequest: true });
    expect(r).toEqual({ mode: 'open-pull-request', checked: false, problems: [] });
  });

  it('refuses a permissions value that is not a JSON object', () => {
    for (const permissions of ['{not json', '[]', '"write"']) {
      const r = checkScopes({ permissions, openPullRequest: false });
      expect(r.problems[0]).toContain('did not parse as a JSON object');
    }
  });
});

describe('the step, as the Action runs it', () => {
  it('exits 1 for open-pull-request under contents: read and says which mode it checked', () => {
    const { code, out, err } = runStep({
      MARLO_OPEN_PULL_REQUEST: 'true',
      GITHUB_TOKEN_PERMISSIONS: perms({ contents: 'read', 'pull-requests': 'write' }),
    });
    expect(code).toBe(1);
    expect(out).toContain('open-pull-request mode');
    expect(err).toContain('refusing to run in the open-pull-request mode');
    expect(err).toContain('contents: write        # create the marlo/ branch');
  });

  it('exits 0 for the default mode under contents: read', () => {
    const { code, out } = runStep({ GITHUB_TOKEN_PERMISSIONS: perms({ contents: 'read' }) });
    expect(code).toBe(0);
    expect(out).toContain('for the report-only mode, nothing excessive');
  });

  it('says the scopes were not checked when the runner gave it nothing', () => {
    const { code, out } = runStep({ MARLO_OPEN_PULL_REQUEST: 'true' });
    expect(code).toBe(0);
    expect(out).toContain('were NOT checked');
  });
});
