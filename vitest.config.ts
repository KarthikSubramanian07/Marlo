import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Workspace packages resolve to their source, not to their built output.
 *
 * Their `exports` point into `dist`, which is correct for a consumer and wrong for the
 * test suite: it makes `pnpm test` depend on a prior `pnpm build`. That passes locally,
 * where the built output happens to exist, and fails in CI on a clean checkout with
 * "Failed to resolve entry for package @marlo/schema".
 *
 * Aliasing to source is the fix rather than adding a build step, for three reasons. A
 * suite that needs a build is a suite contributors run against stale output. The coverage
 * configuration already measures source directories rather than built output, so source is
 * what it was always meant to exercise. And a stack trace pointing at generated JavaScript
 * is a worse debugging experience than one pointing at the line somebody wrote.
 *
 * `pnpm build` still runs as its own CI job, so a broken `exports` map is caught by the
 * thing whose job that is.
 *
 * The list is read from disk rather than hard-coded, because packages arrive branch by
 * branch and a hard-coded name that does not exist yet makes the whole config throw.
 */
const workspaceAliases: Record<string, string> = {};
for (const entry of readdirSync(resolve(import.meta.dirname, 'packages'), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory()) continue;
  const source = resolve(import.meta.dirname, 'packages', entry.name, 'src', 'index.ts');
  if (existsSync(source)) workspaceAliases['@marlo/' + entry.name] = source;
}

/**
 * Three projects, split by what they need rather than by what they test.
 *
 *   unit    no browser, no network, no API keys. This is what `pnpm test` runs
 *           and it is the one that must be green on a clean clone.
 *   browser Playwright and a real Chromium. Opt-in, and CI runs it as its own
 *           job so a divergence between the two renderers shows up as a diff in
 *           the calibration table rather than as a mystery (DECISIONS.md D-005).
 *   e2e     the full pipeline against apps/demo, including golden files.
 *
 * Coverage thresholds are set at a number that can be defended rather than a
 * round number that looks good. The reasoning is in CONTRIBUTING.md under
 * "The coverage number and why it is that number".
 *
 * The per-path overrides matter more than the global figure. A pipeline whose
 * grading protocol is partly covered has an unmeasured accuracy claim, so
 * @marlo/act and the one-directional invariant are held at 100.
 */
export default defineConfig({
  test: {
    globals: false,
    // Packages arrive branch by branch. A project with no tests yet is not a
    // failure; a project whose tests were deleted is caught by the coverage gate.
    passWithNoTests: true,
    reporters: process.env['CI'] === 'true' ? ['default', 'github-actions'] : ['default'],

    projects: [
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: 'unit',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/*/test/**/*.test.ts',
            'scripts/**/*.test.mjs',
          ],
          exclude: ['**/*.browser.test.ts', '**/*.e2e.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: 'browser',
          include: ['**/*.browser.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.e2e.test.ts'],
          environment: 'node',
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/index.ts',
        '**/bin.ts',
        // The empty seam from DECISIONS.md D-007. Covering an interface with no
        // implementation would be covering a comment.
        'packages/render/src/remote.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
        'packages/act/src/**/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'packages/report/src/invariant.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
