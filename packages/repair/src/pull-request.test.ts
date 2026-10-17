import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CalibrationTable, Finding, FixReport, Flag, VerifiedFix } from '@trymarlo/schema';
import {
  CalibrationTable as CalibrationTableSchema,
  FixReport as FixReportSchema,
} from '@trymarlo/schema';
import { branchNameFor, planPullRequest, refusedPath } from './pull-request.js';

/**
 * The planner is pure, so every property the issue asks for is asserted here against
 * fixtures rather than against a repository: the same input plans the same bytes, zero
 * verified fixes opens nothing, each cap bites where it says it does, and two edits on the
 * same bytes exclude the file rather than picking a winner.
 *
 * Every report goes through the Zod schema before it reaches the planner, so a test cannot
 * feed it a shape `marlo fix --json` could not have produced.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const table: CalibrationTable = CalibrationTableSchema.parse(
  JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
);

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: '78fd32-0',
  actRuleId: '78fd32',
  actRuleName: 'Important line height in style attributes is wide enough',
  successCriteria: ['1.4.12'],
  severity: 'moderate',
  reportedBy: 'marlo',
  routingReason: 'best-measured',
  verdict: {
    engine: 'marlo',
    engineVersion: '0.1.0',
    engineRuleId: 'marlo/78fd32',
    actRuleId: '78fd32',
    outcome: 'failed',
    target: { selector: 'p', snippet: '<p style="line-height: 1em !important">', path: ['html'] },
    message: 'line-height is set with !important below 1.5.',
  },
  agreedBy: ['axe-core'],
  disagreements: [],
  confidence: {
    source: 'calibrated',
    precision: 1,
    recall: 1,
    sampleSize: 6,
    meetsAutoFixThreshold: true,
  },
  source: null,
  locationNote: null,
  renderer: 'static',
  help: 'Remove !important from line-height.',
  helpUrl: 'https://act-rules.github.io/rules/78fd32',
  ...over,
});

/** A fix editing `before` to `after` at `start` in `file`. */
const fix = (
  file: string,
  start: number,
  before: string,
  after: string,
  over: Partial<VerifiedFix> = {},
): VerifiedFix => ({
  kind: 'fixed',
  finding: finding({ id: `78fd32-${String(start)}` }),
  actRuleId: '78fd32',
  successCriteria: ['1.4.12'],
  edits: [
    {
      file,
      start,
      end: start + before.length,
      before,
      after,
      kind: 'remove-style-declaration',
      actRuleId: '78fd32',
      insertedElement: null,
      rationale: 'Stop the declaration winning against a reader stylesheet.',
    },
  ],
  verification: {
    targetClosed: true,
    noNewViolations: true,
    idempotent: true,
    enginesRun: ['marlo', 'axe-core'],
    outcomesAfter: [{ engine: 'marlo', actRuleId: '78fd32', outcome: 'passed' }],
    regressions: [],
    durationMs: 3,
  },
  thresholdEvidence: { strictPrecision: 1, strictRecall: 1, threshold: 0.95, sampleSize: 6 },
  ranges: [{ file, start, end: start + after.length, line: 1, column: 1 }],
  summary: 'Removes !important from line-height.',
  howToReject: 'Revert this hunk.',
  ...over,
});

const flag = (over: Partial<Flag> = {}): Flag => ({
  kind: 'flagged',
  finding: finding({
    id: '24afc2-0',
    actRuleId: '24afc2',
    actRuleName: 'Important letter spacing',
  }),
  reason: 'below-threshold',
  explanation: 'marlo reports 24afc2 with strict precision 1.00 over 4 official test cases.',
  humanDecision: 'Read the generated change and apply it if you agree.',
  corroboratedBy: ['marlo'],
  disagreements: [],
  thresholdEvidence: { strictPrecision: 1, strictRecall: 1, threshold: 0.95, sampleSize: 4 },
  unverifiedEdits: [],
  failedVerification: null,
  ...over,
});

const SOURCE = '<p style="line-height: 1em !important; letter-spacing: 0.1em !important">x</p>';
const LINE_HEIGHT = { start: 10, before: 'line-height: 1em !important', after: 'line-height: 1em' };

const report = (
  files: readonly { target: string; source?: string; repairs: readonly (VerifiedFix | Flag)[] }[],
  over: Partial<FixReport> = {},
): FixReport =>
  FixReportSchema.parse({
    schemaVersion: 1,
    runId: '0123456789abcdef',
    marloVersion: '0.1.0',
    startedAt: '2026-10-12T00:00:00.000Z',
    calibration: { generated: '2026-09-15', commit: 'f9d68be', corpusRetrieved: '2026-07-29' },
    engines: [{ id: 'marlo', version: '0.1.0' }],
    renderer: 'static',
    coverage: {
      implemented: 41,
      publishedActRules: 94,
      calibrated: 41,
      unmeasurable: [],
      notEvaluated: [{ actRuleId: 'afw4f7', missing: ['layout'] }],
    },
    files: files.map((f) => ({
      target: f.target,
      source: f.source ?? SOURCE,
      repairs: f.repairs,
      written: false,
    })),
    totals: {
      fixed: files.flatMap((f) => f.repairs).filter((r) => r.kind === 'fixed').length,
      flagged: files.flatMap((f) => f.repairs).filter((r) => r.kind === 'flagged').length,
    },
    ...over,
  });

const oneFix = (file = 'a.html') =>
  fix(file, LINE_HEIGHT.start, LINE_HEIGHT.before, LINE_HEIGHT.after);

describe('planning a pull request', () => {
  it('produces byte-identical output for identical input, twice', () => {
    // The whole pipeline's idempotence rests on this. The opener looks for the branch the
    // planner names, so a plan that differed between two runs over the same state would
    // open a second pull request for the same change.
    const input = {
      reports: [report([{ target: 'a.html', repairs: [oneFix(), flag()] }])],
      table,
      marloVersion: '0.1.0',
    };
    const first = planPullRequest(input);
    const second = planPullRequest(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.kind).toBe('plan');
    if (first.kind !== 'plan') return;
    expect(first.branch).toMatch(/^marlo\/fix-[0-9a-f]{12}$/);
    expect(first.body).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('opens nothing when there are zero verified fixes', () => {
    const plan = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [flag(), flag()] }])],
      table,
      marloVersion: '0.1.0',
    });
    expect(plan.kind).toBe('nothing-to-open');
    if (plan.kind !== 'nothing-to-open') return;
    expect(plan.reason).toContain('2 findings');
    expect(plan.summary.fixesRefused).toBe(2);
    expect(plan.summary.fixesApplied).toBe(0);
  });

  it('opens nothing when there are no findings at all, and says so', () => {
    const plan = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [] }])],
      table,
      marloVersion: '0.1.0',
    });
    expect(plan.kind).toBe('nothing-to-open');
    if (plan.kind !== 'nothing-to-open') return;
    expect(plan.reason).toContain('no findings');
  });

  it('applies the chosen edits to the source it was given', () => {
    const plan = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [oneFix()] }])],
      table,
      marloVersion: '0.1.0',
    });
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.files).toEqual([
      {
        path: 'a.html',
        contents: SOURCE.replace('line-height: 1em !important', 'line-height: 1em'),
      },
    ]);
    expect(plan.summary).toMatchObject({ fixesApplied: 1, fixesRefused: 0, filesChanged: 1 });
  });

  it('names the branch from the content and not from the order the files arrived in', () => {
    const a = { target: 'a.html', repairs: [oneFix('a.html')] };
    const b = { target: 'b.html', repairs: [oneFix('b.html')] };
    const forwards = planPullRequest({ reports: [report([a, b])], table, marloVersion: '0.1.0' });
    const backwards = planPullRequest({ reports: [report([b, a])], table, marloVersion: '0.1.0' });
    expect(forwards.kind).toBe('plan');
    expect(backwards.kind).toBe('plan');
    if (forwards.kind !== 'plan' || backwards.kind !== 'plan') return;
    expect(forwards.branch).toBe(backwards.branch);
    expect(forwards.body).toBe(backwards.body);

    // And a different edit is a different branch.
    const other = fix('a.html', LINE_HEIGHT.start, LINE_HEIGHT.before, 'line-height: 1.5em');
    const changed = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [other] }, b])],
      table,
      marloVersion: '0.1.0',
    });
    if (changed.kind !== 'plan') return;
    expect(changed.branch).not.toBe(forwards.branch);
  });

  it('hashes the sorted edit tuples, so the name is reproducible by hand', () => {
    const edits = oneFix().edits;
    expect(branchNameFor(edits)).toBe(branchNameFor([...edits, ...edits].slice(1)));
    expect(branchNameFor(edits)).toMatch(/^marlo\/fix-[0-9a-f]{12}$/);
  });

  it('renders a body whose fixes carry their measurement and whose flags carry theirs', () => {
    const plan = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [oneFix(), flag()] }])],
      table,
      marloVersion: '0.1.0',
    });
    if (plan.kind !== 'plan') throw new Error(plan.reason);
    expect(plan.body).toContain('## What was fixed');
    expect(plan.body).toContain(
      'strict precision 1.00 over 6 decision-bearing official test cases',
    );
    expect(plan.body).toContain('## What Marlo did not fix');
    expect(plan.body).toContain('over 4 official test cases');
    expect(plan.body).toContain('Did `78fd32` stop failing? | Yes');
    expect(
      plan.body
        .trimEnd()
        .endsWith(
          `Marlo 0.1.0, calibration table generated ${table.generated} at commit \`${table.commit ?? ''}\`.`,
        ),
    ).toBe(true);
    expect(plan.title).toBe('Fix 1 verified accessibility violation in 1 file');
  });

  it('lists the rules fixed in the commit message', () => {
    const plan = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [oneFix()] }])],
      table,
      marloVersion: '0.1.0',
    });
    if (plan.kind !== 'plan') throw new Error(plan.reason);
    expect(plan.commitMessage.split('\n')[0]).toBe(
      'a11y: apply 1 verified accessibility fix across 1 file',
    );
    expect(plan.commitMessage).toContain('78fd32  Important line height');
    expect(plan.commitMessage).toContain('  a.html');
  });
});

describe('the caps', () => {
  it('refuses to plan at all when more files were scanned than the cap', () => {
    const files = ['a', 'b', 'c'].map((n) => ({
      target: `${n}.html`,
      repairs: [oneFix(`${n}.html`)],
    }));
    const plan = planPullRequest({
      reports: [report(files)],
      table,
      marloVersion: '0.1.0',
      caps: { files: 2 },
    });
    expect(plan.kind).toBe('nothing-to-open');
    if (plan.kind !== 'nothing-to-open') return;
    expect(plan.reason).toContain('3 files were scanned, over the cap of 2');
  });

  it('includes no more fixes than the fix cap and says how many were deferred', () => {
    const files = ['a', 'b', 'c', 'd', 'e'].map((n) => ({
      target: `${n}.html`,
      repairs: [oneFix(`${n}.html`)],
    }));
    const plan = planPullRequest({
      reports: [report(files)],
      table,
      marloVersion: '0.1.0',
      caps: { fixes: 3 },
    });
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.files.map((f) => f.path)).toEqual(['a.html', 'b.html', 'c.html']);
    expect(plan.summary.fixesApplied).toBe(3);
    expect(plan.summary.fixesDeferred).toBe(2);
    expect(plan.body).toContain('2 more verified fixes did not fit under the cap of 3');
  });

  it('cuts the flags section first when the body is over the cap, and says how many', () => {
    const flags = Array.from({ length: 40 }, (_, i) =>
      flag({ finding: finding({ id: `24afc2-${String(i)}`, actRuleId: '24afc2' }) }),
    );
    const full = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [oneFix(), ...flags] }])],
      table,
      marloVersion: '0.1.0',
    });
    if (full.kind !== 'plan') throw new Error(full.reason);
    const capped = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [oneFix(), ...flags] }])],
      table,
      marloVersion: '0.1.0',
      caps: { bodyCharacters: Math.floor(full.body.length / 2) },
    });
    expect(capped.kind).toBe('plan');
    if (capped.kind !== 'plan') return;
    expect(capped.body.length).toBeLessThanOrEqual(Math.floor(full.body.length / 2));
    expect(capped.summary.flagsOmitted).toBeGreaterThan(0);
    expect(capped.summary.flagsOmitted).toBeLessThan(40);
    expect(capped.body).toContain(
      `${String(capped.summary.flagsOmitted)} more flag(s) were left out`,
    );
    // The fix and its evidence survived the cut.
    expect(capped.body).toContain('## What was fixed');
    expect(capped.body).toContain('strict precision 1.00 over 6');
    expect(capped.summary.fixesApplied).toBe(1);
    // And the fix count in the summary is the real one, not the trimmed body's.
    expect(capped.summary.fixesRefused).toBe(40);
  });

  it('drops fixes from the plan rather than their evidence from the body', () => {
    // Two fixes whose evidence does not fit together. The second is deferred, diff and
    // evidence both, and the first is still fully evidenced.
    const files = ['a', 'b'].map((n) => ({ target: `${n}.html`, repairs: [oneFix(`${n}.html`)] }));
    const one = planPullRequest({
      reports: [report(files.slice(0, 1))],
      table,
      marloVersion: '0.1.0',
    });
    if (one.kind !== 'plan') throw new Error(one.reason);
    const plan = planPullRequest({
      reports: [report(files)],
      table,
      marloVersion: '0.1.0',
      caps: { bodyCharacters: one.body.length + 200 },
    });
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.files.map((f) => f.path)).toEqual(['a.html']);
    expect(plan.summary.fixesDeferred).toBe(1);
    expect(plan.body).toContain('How this was verified');
  });

  it('opens nothing when even one fix cannot carry its evidence under the cap', () => {
    const plan = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [oneFix()] }])],
      table,
      marloVersion: '0.1.0',
      caps: { bodyCharacters: 500 },
    });
    expect(plan.kind).toBe('nothing-to-open');
    if (plan.kind !== 'nothing-to-open') return;
    expect(plan.reason).toContain('single verified fix exceeds 500 characters');
    expect(plan.summary.fixesDeferred).toBe(1);
  });

  it('bounds the number of flags it will ever try to render', () => {
    const flags = Array.from({ length: 12 }, (_, i) =>
      flag({ finding: finding({ id: `24afc2-${String(i)}`, actRuleId: '24afc2' }) }),
    );
    const plan = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [oneFix(), ...flags] }])],
      table,
      marloVersion: '0.1.0',
      caps: { flagsInBody: 5 },
    });
    if (plan.kind !== 'plan') throw new Error(plan.reason);
    expect(plan.summary.flagsOmitted).toBe(7);
    expect(plan.body).toContain('7 more flag(s) were left out');
  });
});

describe('conflicts and bad input', () => {
  it('excludes a file whose verified fixes touch the same bytes, with a flag per fix', () => {
    const first = oneFix('a.html');
    const second = fix('a.html', LINE_HEIGHT.start, LINE_HEIGHT.before, 'line-height: 1.5', {
      actRuleId: '78fd32',
      finding: finding({ id: '78fd32-other' }),
    });
    const plan = planPullRequest({
      reports: [
        report([
          { target: 'a.html', repairs: [first, second] },
          { target: 'b.html', repairs: [oneFix('b.html')] },
        ]),
      ],
      table,
      marloVersion: '0.1.0',
    });
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    // b.html is planned; a.html is not, and nothing from it was applied.
    expect(plan.files.map((f) => f.path)).toEqual(['b.html']);
    expect(plan.summary.filesExcluded).toEqual([
      { path: 'a.html', reason: expect.stringContaining('touch the same bytes') },
    ]);
    expect(plan.summary.fixesApplied).toBe(1);
    expect(plan.summary.fixesRefused).toBe(2);
    expect(plan.body).toContain('not fixed: **conflicting-edits**');
    expect(plan.body).toContain('Two verified fixes in a.html touch the same bytes');
    // The excluded fixes show their generated change as evidence, never as applied.
    expect(plan.body).toContain('A change Marlo generated and could not verify');
  });

  it('opens nothing when the only file with fixes was excluded for a conflict', () => {
    const first = oneFix('a.html');
    const second = fix('a.html', LINE_HEIGHT.start, LINE_HEIGHT.before, 'line-height: 1.5', {
      finding: finding({ id: '78fd32-other' }),
    });
    const plan = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [first, second] }])],
      table,
      marloVersion: '0.1.0',
    });
    expect(plan.kind).toBe('nothing-to-open');
    if (plan.kind !== 'nothing-to-open') return;
    expect(plan.summary.fixesRefused).toBe(2);
    expect(plan.summary.filesExcluded).toHaveLength(1);
  });

  it('excludes a file whose source does not contain what the edits expected', () => {
    const plan = planPullRequest({
      reports: [
        report([
          { target: 'a.html', source: '<p>changed underneath</p>', repairs: [oneFix('a.html')] },
          { target: 'b.html', repairs: [oneFix('b.html')] },
        ]),
      ],
      table,
      marloVersion: '0.1.0',
    });
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.files.map((f) => f.path)).toEqual(['b.html']);
    expect(plan.summary.filesExcluded[0]?.reason).toContain('did not apply to the source');
    expect(plan.body).toContain('Left out entirely: a.html');
  });

  it('opens nothing when every file with a fix had a stale source', () => {
    const plan = planPullRequest({
      reports: [
        report([{ target: 'a.html', source: '<p>changed</p>', repairs: [oneFix('a.html')] }]),
      ],
      table,
      marloVersion: '0.1.0',
    });
    expect(plan.kind).toBe('nothing-to-open');
    if (plan.kind !== 'nothing-to-open') return;
    expect(plan.reason).toContain('every file with a verified fix was excluded');
  });

  it('uses the first entry for a path listed twice and records the duplicate', () => {
    const plan = planPullRequest({
      reports: [
        report([{ target: 'a.html', repairs: [oneFix()] }]),
        report([{ target: 'a.html', repairs: [oneFix()] }]),
      ],
      table,
      marloVersion: '0.1.0',
    });
    if (plan.kind !== 'plan') throw new Error(plan.reason);
    expect(plan.files).toHaveLength(1);
    expect(plan.summary.filesExcluded).toEqual([
      { path: 'a.html', reason: expect.stringContaining('listed twice') },
    ]);
  });

  it('unions the rules that were not evaluated across several reports', () => {
    const second = report([{ target: 'b.html', repairs: [oneFix('b.html')] }], {
      coverage: {
        implemented: 41,
        publishedActRules: 94,
        calibrated: 41,
        unmeasurable: [],
        notEvaluated: [{ actRuleId: '09o5cg', missing: ['layout', 'paint'] }],
      },
    });
    const plan = planPullRequest({
      reports: [report([{ target: 'a.html', repairs: [oneFix()] }]), second],
      table,
      marloVersion: '0.1.0',
    });
    if (plan.kind !== 'plan') throw new Error(plan.reason);
    expect(plan.body).toContain('`09o5cg` needs layout and paint');
    expect(plan.body).toContain('`afw4f7` needs layout');
  });

  it('never plans a write under .github/ or outside the repository', () => {
    const targets = [
      '.github/workflows/ci.html',
      '/abs/page.html',
      'C:\\site\\page.html',
      '../elsewhere.html',
      './a.html',
      'pages//a.html',
    ];
    const plan = planPullRequest({
      reports: [
        report([
          ...targets.map((target) => ({ target, repairs: [oneFix(target)] })),
          { target: 'ok.html', repairs: [oneFix('ok.html')] },
        ]),
      ],
      table,
      marloVersion: '0.1.0',
    });
    if (plan.kind !== 'plan') throw new Error(plan.reason);
    expect(plan.files.map((f) => f.path)).toEqual(['ok.html']);
    expect(plan.summary.filesExcluded.map((x) => x.path).sort()).toEqual([...targets].sort());
    expect(plan.summary.fixesRefused).toBe(targets.length);
    expect(refusedPath('.github/workflows/ci.html')).toContain('never edits');
    expect(refusedPath('apps/demo/checkout.html')).toBeNull();
  });

  it('says why when every verified fix was in a path it may not write', () => {
    const plan = planPullRequest({
      reports: [report([{ target: '.github/x.html', repairs: [oneFix('.github/x.html')] }])],
      table,
      marloVersion: '0.1.0',
    });
    expect(plan.kind).toBe('nothing-to-open');
    if (plan.kind !== 'nothing-to-open') return;
    expect(plan.reason).toContain('may not write');
    expect(plan.summary.fixesRefused).toBe(1);
  });

  it('plans nothing from an empty set of reports', () => {
    const plan = planPullRequest({ reports: [], table, marloVersion: '0.1.0' });
    expect(plan.kind).toBe('nothing-to-open');
  });
});
