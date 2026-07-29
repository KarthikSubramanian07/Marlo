import { defineConfig } from 'vitest/config';

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
        test: {
          name: 'browser',
          include: ['**/*.browser.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
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
      reporter: ['text-summary', 'lcov', 'json-summary'],
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
