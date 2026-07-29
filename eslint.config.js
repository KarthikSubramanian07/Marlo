// @ts-check
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';

/**
 * The rules here are the ones that would let a bug through, not the ones that
 * make code look uniform. Prettier owns appearance.
 *
 * Three carry design weight rather than style preference:
 *
 *   no-floating-promises catches a re-scan that was never awaited, which would
 *   report a fix as verified before the verification finished.
 *
 *   consistent-type-assertions set to never in @marlo/schema: a trust boundary
 *   that casts instead of parsing is the whole failure mode Zod is there to
 *   prevent.
 *
 *   no-restricted-properties on process.env: configuration goes through the
 *   validated config, so a required key cannot be introduced without appearing
 *   in SETUP.md.
 *
 * Typed linting is scoped to TypeScript files. Config files and the plain .mjs
 * scripts are linted without type information, because putting them in the
 * typed project would mean maintaining a tsconfig for tooling that has no types
 * to check.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'corpus/**',
      'tests/golden/**',
      'docs/screenshots/**',
      '**/*.d.ts',
    ],
  },

  // Everything TypeScript, with type information.
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    rules: {
      // Correctness.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],

      // Import hygiene. A cycle between packages is how a pure package stops
      // being pure without anyone noticing.
      'import-x/no-cycle': ['error', { maxDepth: 6 }],
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',

      // Secret hygiene, as a lint rather than a review habit.
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read configuration through the validated config in @marlo/schema. Direct ' +
            'process.env access skips validation and hides required keys from SETUP.md.',
        },
      ],

      // Console output is a product surface here, so it goes through
      // @marlo/report rather than being sprinkled around. Exemptions below.
      'no-console': 'error',
      'no-debugger': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // The schema package is the trust boundary. Casting there defeats the point.
  {
    files: ['packages/schema/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },

  // Surfaces that legitimately write to stdout, and read the environment
  // because reading the environment is their job.
  {
    files: [
      'packages/cli/**/*.ts',
      'packages/report/src/terminal.ts',
      'packages/calibrate/src/bin.ts',
      'packages/mcp/src/bin.ts',
      'packages/action/src/bin.ts',
      'apps/*/scripts/**/*.ts',
    ],
    rules: { 'no-console': 'off', 'no-restricted-properties': 'off' },
  },

  // Tests may reach for the sharp tools. They are the ones proving the sharp
  // edges behave.
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      'no-console': 'off',
      'no-restricted-properties': 'off',
    },
  },

  // Config files: they read the environment because that is what a config does.
  {
    files: ['vitest.config.ts', 'vitest.workspace.ts', '*.config.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },

  // Config files and plain scripts: linted, but not type-aware.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { sourceType: 'module', ecmaVersion: 2023 },
    rules: {
      'no-console': 'off',
      'no-debugger': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
