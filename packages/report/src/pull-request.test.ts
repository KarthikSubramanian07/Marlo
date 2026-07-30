import { describe, expect, it } from 'vitest';
import type { Finding, Flag, PullRequestBody, VerifiedFix } from '@marlo/schema';
import { PullRequestBody as PullRequestBodySchema } from '@marlo/schema';
import { pullRequestTitle, renderPullRequestBody } from './pull-request.js';

/**
 * The pull request body had no tests at all, and it is one of the two surfaces developers
 * judge Marlo by. It was found by running the coverage gate rather than by review: the file
 * sat at 0 percent while the repository claimed enforced thresholds that nothing had checked.
 *
 * Every fixture here goes through the Zod schema before it reaches the renderer, so a test
 * cannot assert against a shape the schema would reject.
 */

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'e086e5-0',
  actRuleId: 'e086e5',
  actRuleName: 'Form field has non-empty accessible name',
  successCriteria: ['1.3.1', '4.1.2'],
  severity: 'critical',
  reportedBy: 'axe-core',
  routingReason: 'best-measured',
  verdict: {
    engine: 'axe-core',
    engineVersion: '4.12.1',
    engineRuleId: 'label',
    actRuleId: 'e086e5',
    outcome: 'failed',
    target: {
      selector: 'input[name="postcode"]',
      snippet: '<input name="postcode">',
      path: ['html', 'body', 'form'],
    },
    message: 'Form elements must have labels',
  },
  agreedBy: ['marlo'],
  disagreements: [],
  confidence: {
    source: 'calibrated',
    precision: 1,
    recall: 0.94,
    sampleSize: 17,
    meetsAutoFixThreshold: true,
  },
  source: null,
  locationNote: 'Source location arrives with the repair layer.',
  renderer: 'static',
  help: 'Form elements must have labels',
  helpUrl: 'https://act-rules.github.io/rules/e086e5',
  ...over,
});

const fix = (over: Partial<VerifiedFix> = {}): VerifiedFix => ({
  kind: 'fixed',
  finding: finding(),
  actRuleId: 'e086e5',
  successCriteria: ['1.3.1', '4.1.2'],
  edits: [
    {
      file: 'checkout.html',
      start: 100,
      end: 108,
      before: '12345678',
      after: '<label for="postcode">Postcode</label>',
      kind: 'insert-element',
      actRuleId: 'e086e5',
      insertedElement: 'label',
      rationale: 'A placeholder disappears on focus, so it cannot be the only label.',
    },
  ],
  verification: {
    targetClosed: true,
    noNewViolations: true,
    idempotent: true,
    enginesRun: ['axe-core', 'marlo'],
    outcomesAfter: [
      { engine: 'axe-core', actRuleId: 'e086e5', outcome: 'passed' },
      { engine: 'marlo', actRuleId: 'e086e5', outcome: 'passed' },
    ],
    regressions: [],
    durationMs: 42,
  },
  ranges: [{ file: 'checkout.html', start: 100, end: 108, line: 12, column: 4 }],
  summary: 'Adds the label the placeholder was standing in for.',
  howToReject: 'Delete this commit, or reply "reject e086e5" on this pull request.',
  ...over,
});

const flag = (over: Partial<Flag> = {}): Flag =>
  ({
    kind: 'flagged',
    finding: finding({
      id: 'afw4f7-0',
      actRuleId: 'afw4f7',
      actRuleName: 'Text has minimum contrast',
      successCriteria: ['1.4.3'],
      severity: 'serious',
      reportedBy: 'alfa',
    }),
    reason: 'design-decision',
    explanation: "Recolouring is somebody's choice, so Marlo located the text and stopped.",
    humanDecision: 'Pick a foreground colour that clears 4.5:1 on this background.',
    corroboratedBy: ['alfa'],
    disagreements: [],
    thresholdEvidence: null,
    unverifiedEdits: [],
    ...over,
  }) as Flag;

const body = (over: Partial<PullRequestBody> = {}): PullRequestBody =>
  PullRequestBodySchema.parse({
    title: 'Add the four labels a placeholder was standing in for',
    summary: 'Five form fields had no accessible name.',
    fixes: [fix()],
    flags: [flag()],
    coverage: {
      implemented: 35,
      publishedActRules: 94,
      calibrated: 35,
      unmeasurable: [],
      notEvaluated: [{ actRuleId: 'afw4f7', missing: ['layout', 'paint'] }],
    },
    engines: [
      { id: 'axe-core', version: '4.12.1' },
      { id: 'marlo', version: '0.1.0' },
    ],
    renderer: 'static',
    calibration: {
      generated: '2026-07-30',
      commit: 'abc1234',
      url: 'https://github.com/KarthikSubramanian07/Marlo/blob/main/calibration/table.json',
    },
    howToReject: {
      all: 'Close this pull request.',
      single: 'Reply with the rule id.',
      permanently: 'Add the rule to marlo.config.json under never.',
    },
    successCriteria: ['1.3.1', '1.4.3', '4.1.2'],
    ...over,
  });

describe('the pull request body', () => {
  it('uses the title verbatim', () => {
    expect(pullRequestTitle(body())).toBe('Add the four labels a placeholder was standing in for');
  });

  it('leads with what was wrong rather than with what was changed', () => {
    const rendered = renderPullRequestBody(body());
    expect(rendered.startsWith('Five form fields had no accessible name.')).toBe(true);
  });

  it('states coverage as a fraction with its denominator', () => {
    // The single most important line in the body. A percentage with no denominator is the
    // claim this project exists to argue against.
    expect(renderPullRequestBody(body())).toContain('35 of 94');
  });

  it('says how to reject the whole thing, one fix, and future ones', () => {
    // Not politeness. Pull request remediation is opt-in per D-011, and a pull request that
    // does not say how to refuse it is not opt-in in practice.
    const rendered = renderPullRequestBody(body());
    expect(rendered).toContain('Close this pull request.');
    expect(rendered).toContain('Reply with the rule id.');
    expect(rendered).toContain('Add the rule to marlo.config.json under never.');
  });

  it('answers the three verification questions separately', () => {
    // Passing two and failing the third is a fix that broke something else, so the body may
    // not collapse them into the word "verified".
    const rendered = renderPullRequestBody(body());
    expect(rendered).not.toMatch(/\bverified\b\s*$/m);
    expect(rendered.toLowerCase()).toContain('idempotent');
    expect(rendered).toContain('axe-core');
  });

  it('gives every flag its evidence and the decision being handed over', () => {
    const rendered = renderPullRequestBody(body());
    expect(rendered).toContain('Pick a foreground colour that clears 4.5:1');
    expect(rendered).toContain('afw4f7');
  });

  it('names the calibration table the accuracy claims rest on', () => {
    expect(renderPullRequestBody(body())).toContain('calibration/table.json');
  });

  it('reports a rule that could not be evaluated rather than omitting it', () => {
    const rendered = renderPullRequestBody(body());
    expect(rendered).toContain('afw4f7');
    expect(rendered.toLowerCase()).toMatch(/not evaluated|layout/);
  });

  it('renders with no fixes at all, which is the flag-only case', () => {
    const rendered = renderPullRequestBody(body({ fixes: [] }));
    expect(rendered).toContain('Pick a foreground colour');
    expect(rendered).not.toContain('## What was fixed');
  });

  it('renders with no flags at all', () => {
    const rendered = renderPullRequestBody(body({ flags: [] }));
    expect(rendered).toContain('## What was fixed');
  });

  it('renders an empty body without throwing', () => {
    // Nothing generates this today, and something eventually will.
    const rendered = renderPullRequestBody(body({ fixes: [], flags: [], successCriteria: [] }));
    expect(rendered).toContain('none');
  });

  it('escapes a snippet containing backticks so it cannot break out of its fence', () => {
    // A page containing ``` in an attribute would otherwise close the code block and let the
    // rest of the snippet render as markdown, in a body a reviewer is about to trust.
    const nasty = fix({
      edits: [
        {
          file: 'evil.html',
          start: 0,
          end: 3,
          before: '```',
          after: '```` still inside ````',
          kind: 'set-attribute-value',
          actRuleId: 'e086e5',
          insertedElement: null,
          rationale: 'Fence length is computed from the content.',
        },
      ],
    });
    const rendered = renderPullRequestBody(body({ fixes: [nasty] }));
    // The fence has to be longer than the longest run of backticks inside it.
    const fences = [...rendered.matchAll(/^(`{3,})/gm)].map((m) => (m[1] ?? '').length);
    expect(Math.max(...fences)).toBeGreaterThan(4);
  });

  it('records the element an insert introduces, for review', () => {
    expect(renderPullRequestBody(body())).toContain('label');
  });

  it('marks severity with a text mark and not only a word', () => {
    // The same marks the terminal prints, so the body survives a reader who cannot separate
    // red from amber and a diff viewer that strips colour entirely.
    expect(renderPullRequestBody(body())).toMatch(/[·▲]/);
  });

  it('reports a flag whose reason is a threshold with the measured numbers', () => {
    const belowThreshold = flag({
      reason: 'below-threshold',
      thresholdEvidence: {
        strictPrecision: 0.71,
        strictRecall: 0.62,
        threshold: 0.95,
        sampleSize: 17,
      },
    });
    const rendered = renderPullRequestBody(body({ flags: [belowThreshold] }));
    expect(rendered).toContain('0.71');
    expect(rendered).toContain('0.95');
  });

  it('shows an unverified repair as evidence without ever presenting it as applied', () => {
    const failed = flag({
      reason: 'verification-failed',
      unverifiedEdits: [
        {
          file: 'checkout.html',
          start: 0,
          end: 0,
          before: '',
          after: '<label>Postcode</label>',
          kind: 'insert-element',
          actRuleId: 'e086e5',
          insertedElement: 'label',
          rationale: 'Generated, then not confirmed by re-running the engines.',
        },
      ],
    });
    const rendered = renderPullRequestBody(body({ fixes: [], flags: [failed] }));
    expect(rendered).toContain('could not verify');
    expect(rendered).toContain('Not applied.');
    expect(rendered).toContain('Generated, then not confirmed by re-running the engines.');
    // It is in the flags section, not in the diff of what was changed.
    expect(rendered).not.toContain('## What was fixed');
  });
});
