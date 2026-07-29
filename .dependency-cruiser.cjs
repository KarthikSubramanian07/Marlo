/**
 * Architecture, asserted rather than described.
 *
 * PLAN.md §3 says pure logic is separated from I/O by package boundary rather
 * than by convention. This file is what makes that sentence true. Two rules
 * carry real design weight and both come out of DECISIONS.md:
 *
 *   marlo-rules-cannot-see-peers (D-008). The sibling project's worst defect
 *   survived because its auditor searched for the same wrong URI its writer
 *   emitted, so it confirmed its own bug and reported success. If @marlo/rules
 *   could import @marlo/engines, Marlo's engine could see peer results while
 *   deciding, and its column in the calibration table would stop meaning
 *   anything.
 *
 *   pure-packages-have-no-io. @marlo/schema, @marlo/act and @marlo/rules are
 *   callable as pure functions over fixtures, which is what makes the whole
 *   pipeline testable without a browser or a network.
 */
module.exports = {
  forbidden: [
    {
      name: 'marlo-rules-cannot-see-peers',
      severity: 'error',
      comment:
        'DECISIONS.md D-008: @marlo/rules is graded in the same table as its peers, so it must ' +
        'not be able to observe them. Marking its own homework is the defect this project ' +
        'exists to argue against.',
      from: { path: '^packages/rules' },
      to: { path: '^packages/(engines|calibrate|repair|report|cli|mcp|action)' },
    },
    {
      name: 'pure-packages-have-no-io',
      severity: 'error',
      comment:
        'PLAN.md §3: schema, act and rules are pure. No filesystem, no network, no child ' +
        'processes. A rule that reads a file cannot be run as a pure function over a fixture.',
      from: { path: '^packages/(schema|act|rules)/src' },
      to: {
        dependencyTypes: ['core'],
        path: '^(fs|fs/promises|node:fs|node:fs/promises|http|https|node:http|node:https|net|node:net|child_process|node:child_process|dns|node:dns|worker_threads|node:worker_threads)$',
      },
    },
    {
      name: 'schema-depends-on-nothing-of-ours',
      severity: 'error',
      comment:
        '@marlo/schema is the vocabulary. If it imported a package that uses it, the vocabulary ' +
        'would depend on a speaker.',
      from: { path: '^packages/schema/src' },
      to: { path: '^packages/(?!schema)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle between packages means the boundary is decorative.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'A module nothing imports is either dead or a missing wire-up.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(package|vitest\\.config)\\.json$',
          '\\.test\\.ts$',
          '/bin\\.ts$',
          '/index\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        'A production import of a devDependency works locally and breaks for the person who ' +
        'installed the published package.',
      from: { path: '^(packages|apps)', pathNot: '\\.(test|spec)\\.ts$|/test/' },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys|querystring)$' },
    },
    {
      name: 'engines-go-through-the-render-seam',
      severity: 'error',
      comment:
        'DECISIONS.md D-005: an engine adapter that imports happy-dom or playwright directly ' +
        'bypasses the capability model, and a rule needing layout could then silently pass on a ' +
        'renderer that has none.',
      from: { path: '^packages/engines/src' },
      to: { dependencyTypes: ['npm'], path: '^(happy-dom|playwright|playwright-core)$' },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|corpus)(/|$)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.ts', '.mjs', '.cjs'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
