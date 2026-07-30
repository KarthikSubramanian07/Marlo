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
const packagesDir = resolve(import.meta.dirname, 'packages');
const workspaceAliases: Record<string, string> = {};

// existsSync before readdirSync: git does not track empty directories, so on a branch that
// has not created a package yet there is no packages directory at all, and readdirSync
// throws ENOENT before a single test runs.
if (existsSync(packagesDir)) {
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = resolve(packagesDir, entry.name, 'src', 'index.ts');
    if (existsSync(source)) workspaceAliases['@marlo/' + entry.name] = source;
  }
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
          // The e2e project's include would otherwise pick these up too, and they would fail on
          // a machine with no Chromium. Splitting by filename keeps `pnpm check` offline.
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
      /*
       * Measured, not aspired to.
       *
       * These were 85/80/85/85 and the gate had never run: no CI job invoked it, and it
       * failed on the first invocation. A threshold nothing checks is a claim, and this
       * repository has a script whose whole job is to fail the build on claims like that.
       *
       * They now sit just under the measured figures, so any regression fails and any
       * improvement is a one-line pull request. There is a CI job.
       *
       * `test:coverage` names the two projects it measures rather than running all of them.
       * It used to run every project, which was harmless only for as long as the browser
       * project was empty: the first test added to it made the coverage job need a Chromium
       * it does not install, and the gate failed for a reason that had nothing to do with
       * coverage. The thresholds below were measured against the offline suite, so that is
       * what the gate measures.
       *
       * Branches run 14 points below statements, and that gap is structural rather than
       * neglect. Under noUncheckedIndexedAccess every array index produces `T | undefined`,
       * so every `?.` and `??` guarding one is a branch, and a good number of them are
       * unreachable by construction. Two were found while raising this: one in decideRule
       * guarding a routing state the schema now forbids, and one where a double fallback was
       * narrowing something the logic had already narrowed. Both were deleted rather than
       * tested. The remainder are of the same kind, and chasing them with tests that
       * construct impossible inputs would make the number better and the suite worse.
       */
      thresholds: {
        statements: 87,
        branches: 73,
        functions: 90,
        lines: 88,
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
