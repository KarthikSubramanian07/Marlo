import { describe, expect, it } from 'vitest';

import type { Coverage, Edit, Finding, Verification } from './index.js';
import {
  ACT_ALLOWED_OUTCOMES,
  ActRuleId,
  CalibrationTable,
  Coverage as CoverageSchema,
  Edit as EditSchema,
  EXIT_CODES,
  MarloConfig,
  Outcome,
  Repair,
  RENDERER_CAPABILITIES,
  RuleResult,
  SEVERITY_PRESENTATION,
  Severity,
  SourceRange,
  SuccessCriterion,
  Verification as VerificationSchema,
  formatCoverage,
  isFullyVerified,
  isVerifiedFix,
  parseEnvironment,
  redactConfig,
  worstSeverity,
} from './index.js';

/**
 * These tests do not check that Zod works. They check the four claims this
 * package makes that a reader would otherwise have to take on trust:
 *
 *   A fix cannot be reported without a verification attached.
 *   A rule that crashed or could not be evaluated cannot be read as a pass.
 *   Coverage cannot be stated without its denominator.
 *   The ACT allowed-outcome table matches the published protocol.
 */

describe('a fix cannot exist without its verification', () => {
  const finding: Finding = {
    id: 'f1',
    actRuleId: 'b5c3f8',
    actRuleName: 'HTML page has lang attribute',
    successCriteria: ['3.1.1'],
    severity: 'serious',
    reportedBy: 'marlo',
    routingReason: 'best-measured',
    verdict: {
      engine: 'marlo',
      engineVersion: '0.1.0',
      engineRuleId: 'marlo/b5c3f8',
      actRuleId: 'b5c3f8',
      outcome: 'failed',
      target: { selector: 'html', snippet: '<html>', path: ['html'] },
      message: 'The html element has no lang attribute.',
    },
    agreedBy: ['axe-core'],
    disagreements: [],
    confidence: {
      source: 'calibrated',
      precision: 1,
      recall: 1,
      sampleSize: 7,
      meetsAutoFixThreshold: true,
    },
    source: { file: 'index.html', start: 15, end: 21, line: 1, column: 16 },
    locationNote: null,
    renderer: 'static',
    help: 'Add a lang attribute naming the page language.',
    helpUrl: 'https://trymarlo.pages.dev/rules/b5c3f8',
  };

  const edit: Edit = {
    file: 'index.html',
    start: 15,
    end: 21,
    before: '<html>',
    after: '<html lang="en">',
    kind: 'add-attribute',
    actRuleId: 'b5c3f8',
    insertedElement: null,
    rationale: 'Declare the page language so assistive technology selects the right voice.',
  };

  const verification: Verification = {
    targetClosed: true,
    noNewViolations: true,
    idempotent: true,
    enginesRun: ['marlo', 'axe-core', 'alfa'],
    outcomesAfter: [
      { engine: 'marlo', actRuleId: 'b5c3f8', outcome: 'passed' },
      { engine: 'axe-core', actRuleId: 'b5c3f8', outcome: 'passed' },
    ],
    regressions: [],
    durationMs: 12,
  };

  const fixed = {
    kind: 'fixed',
    finding,
    actRuleId: 'b5c3f8',
    successCriteria: ['3.1.1'],
    edits: [edit],
    verification,
    ranges: [{ file: 'index.html', start: 15, end: 31, line: 1, column: 16 }],
    summary: 'Added lang="en" to the html element.',
    howToReject: 'Delete this line from the diff and Marlo will not propose it again.',
  };

  it('accepts a fix that carries one', () => {
    const parsed = Repair.safeParse(fixed);
    expect(parsed.success).toBe(true);
  });

  it('rejects a fix with the verification removed', () => {
    const { verification: _dropped, ...withoutVerification } = fixed;
    const parsed = Repair.safeParse(withoutVerification);
    expect(parsed.success).toBe(false);
  });

  it('rejects a fix with a null verification', () => {
    const parsed = Repair.safeParse({ ...fixed, verification: null });
    expect(parsed.success).toBe(false);
  });

  it('rejects a fix with no edits, because that is not a change', () => {
    const parsed = Repair.safeParse({ ...fixed, edits: [] });
    expect(parsed.success).toBe(false);
  });

  it('has no third kind and no state meaning claimed', () => {
    // The union is exhaustive on purpose. Anything else is a schema change that
    // every consumer's switch statement will refuse to compile against.
    for (const kind of ['claimed', 'attempted', 'probably-fixed', 'pending']) {
      expect(Repair.safeParse({ ...fixed, kind }).success).toBe(false);
    }
  });

  it('does not treat a partial verification as verified', () => {
    // The three bars are separate questions. A caller checking only targetClosed
    // would report a fix that broke something else as a success.
    expect(isFullyVerified(verification)).toBe(true);
    expect(isFullyVerified({ ...verification, noNewViolations: false })).toBe(false);
    expect(isFullyVerified({ ...verification, idempotent: false })).toBe(false);
    expect(isFullyVerified({ ...verification, targetClosed: false })).toBe(false);
  });

  it('requires at least one engine to have been re-run', () => {
    const parsed = VerificationSchema.safeParse({ ...verification, enginesRun: [] });
    expect(parsed.success).toBe(false);
  });

  it('narrows correctly', () => {
    const repair = Repair.parse(fixed);
    expect(isVerifiedFix(repair)).toBe(true);
    if (isVerifiedFix(repair)) {
      // The point of the guard: `verification` is reachable without a null check.
      expect(repair.verification.targetClosed).toBe(true);
    }
  });

  it('requires a flag to name who corroborated it', () => {
    const flag = {
      kind: 'flagged',
      finding,
      reason: 'design-decision',
      explanation: 'Recolouring is a design decision rather than a mechanical correction.',
      humanDecision: 'Choose a foreground colour that reaches 4.5:1 against this background.',
      corroboratedBy: [],
      disagreements: [],
      thresholdEvidence: null,
      unverifiedEdits: [],
      failedVerification: null,
    };
    // A flag nobody corroborated is a guess, and a guess in a pull request body is
    // noise the reader learns to skip.
    expect(Repair.safeParse(flag).success).toBe(false);
    expect(Repair.safeParse({ ...flag, corroboratedBy: ['axe-core'] }).success).toBe(true);
  });
});

describe('an edit cannot silently corrupt a file', () => {
  const base: Edit = {
    file: 'a.html',
    start: 0,
    end: 6,
    before: '<html>',
    after: '<html lang="en">',
    kind: 'add-attribute',
    actRuleId: 'b5c3f8',
    insertedElement: null,
    rationale: 'Declare the page language.',
  };

  it('requires before to be exactly the bytes the range covers', () => {
    // Application compares `before` against the file before replacing. If the
    // length disagrees with the range, one of the two is wrong and applying it
    // would shift every later offset.
    expect(EditSchema.safeParse(base).success).toBe(true);
    expect(EditSchema.safeParse({ ...base, before: '<html' }).success).toBe(false);
    expect(EditSchema.safeParse({ ...base, end: 5 }).success).toBe(false);
  });

  it('rejects an inverted range', () => {
    expect(EditSchema.safeParse({ ...base, start: 6, end: 0, before: '' }).success).toBe(false);
  });

  it('makes insert-element declare what it inserts', () => {
    // The most dangerous entry on the allow-list, so it carries its own field and
    // review can see exactly what appears in the document.
    const insert = {
      ...base,
      kind: 'insert-element',
      before: '',
      end: 0,
      after: '<a href="#main" class="skip">Skip to content</a>',
      insertedElement: 'a',
    };
    expect(EditSchema.safeParse(insert).success).toBe(true);
    expect(EditSchema.safeParse({ ...insert, insertedElement: null }).success).toBe(false);
  });

  it('rejects an edit kind that is not on the allow-list', () => {
    // A repair needing an operation not on the list is a flag, not a new entry
    // added quietly. Reformatting and rewriting are absent by design.
    for (const kind of ['rewrite-file', 'reformat', 'reorder-imports', 'replace-children']) {
      expect(EditSchema.safeParse({ ...base, kind }).success).toBe(false);
    }
  });

  it('requires every edit to name the rule it serves', () => {
    const { actRuleId: _dropped, ...orphan } = base;
    expect(EditSchema.safeParse(orphan).success).toBe(false);
    expect(EditSchema.safeParse({ ...base, actRuleId: 'not-an-id' }).success).toBe(false);
  });
});

describe('a rule that did not run cannot be read as a pass', () => {
  it('keeps error and unsupported distinct from ok', () => {
    const errored = RuleResult.parse({
      actRuleId: 'afw4f7',
      engine: 'marlo',
      status: 'error',
      verdicts: [],
      error: 'Cannot read properties of null',
      missingCapabilities: [],
      durationMs: 3,
    });
    const unsupported = RuleResult.parse({
      actRuleId: 'afw4f7',
      engine: 'marlo',
      status: 'unsupported',
      verdicts: [],
      error: null,
      missingCapabilities: ['layout'],
      durationMs: 0,
    });

    // Both have no verdicts. So does a rule that ran and found nothing. The only
    // thing distinguishing them is `status`, which is why it is not optional.
    expect(errored.verdicts).toHaveLength(0);
    expect(unsupported.verdicts).toHaveLength(0);
    expect(errored.status).not.toBe('ok');
    expect(unsupported.status).not.toBe('ok');
    expect(unsupported.missingCapabilities).toEqual(['layout']);
  });

  it('does not let status default to ok', () => {
    // If `status` had a default, a producer that forgot it would report a crash as
    // a clean result. That is the sibling project's defect in one field.
    const parsed = RuleResult.safeParse({
      actRuleId: 'afw4f7',
      engine: 'marlo',
      verdicts: [],
      durationMs: 1,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('coverage cannot be stated without its denominator', () => {
  const coverage: Coverage = {
    implemented: 34,
    publishedActRules: 94,
    calibrated: 33,
    unmeasurable: ['kb1m8s'],
    notEvaluated: [{ actRuleId: 'afw4f7', missing: ['layout'] }],
  };

  it('formats as a fraction', () => {
    expect(formatCoverage(coverage)).toBe('34 of 94 published ACT rules');
  });

  it('has no percentage field to reach for', () => {
    // The type is the enforcement. A consumer wanting a percentage has to divide,
    // at which point they are holding the denominator.
    const keys = Object.keys(CoverageSchema.parse(coverage));
    for (const forbidden of ['percentage', 'percent', 'pct', 'ratio', 'score']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('refuses a zero denominator rather than dividing by it', () => {
    expect(CoverageSchema.safeParse({ ...coverage, publishedActRules: 0 }).success).toBe(false);
  });

  it('names the rules it cannot measure rather than omitting them', () => {
    // Three published ACT rules have no official test cases. Leaving them out
    // would overstate coverage; counting them as calibrated would overstate
    // accuracy. They are named.
    expect(coverage.unmeasurable).toContain('kb1m8s');
    expect(coverage.calibrated).toBeLessThan(coverage.implemented);
  });
});

describe('the ACT allowed-outcome protocol', () => {
  it('matches the published table exactly', () => {
    // Transcribed from pages/implementations/mapping.md in the ACT rules
    // repository. If this test is edited, the protocol has changed and the
    // calibration table's meaning has changed with it.
    expect(ACT_ALLOWED_OUTCOMES.passed).toEqual(['passed', 'cantTell', 'inapplicable']);
    expect(ACT_ALLOWED_OUTCOMES.failed).toEqual(['failed', 'cantTell']);
    expect(ACT_ALLOWED_OUTCOMES.inapplicable).toEqual(['inapplicable', 'cantTell', 'passed']);
  });

  it('allows cantTell everywhere, which is the whole problem', () => {
    // This is the finding that produced DECISIONS.md D-004. A tool answering
    // cantTell on all 1134 test cases is a correct implementation of every rule
    // under the official protocol, and useless to a developer. Asserted here so
    // that the reason the table has two views is visible in a test rather than
    // only in a document.
    for (const expected of ['passed', 'failed', 'inapplicable'] as const) {
      expect(ACT_ALLOWED_OUTCOMES[expected]).toContain('cantTell');
    }
  });

  it('never allows failed on a passing example', () => {
    expect(ACT_ALLOWED_OUTCOMES.passed).not.toContain('failed');
    expect(ACT_ALLOWED_OUTCOMES.inapplicable).not.toContain('failed');
  });

  it('is frozen, so a consumer cannot widen it at runtime', () => {
    expect(Object.isFrozen(ACT_ALLOWED_OUTCOMES)).toBe(true);
    expect(Object.isFrozen(ACT_ALLOWED_OUTCOMES.failed)).toBe(true);
  });
});

describe('severity is never colour alone', () => {
  it('gives every severity a text mark', () => {
    for (const severity of Severity.options) {
      const presentation = SEVERITY_PRESENTATION[severity];
      expect(presentation.mark.length).toBeGreaterThan(0);
      expect(presentation.label).toBe(severity);
    }
  });

  it('gives every severity a distinct mark', () => {
    const marks = Severity.options.map((s) => SEVERITY_PRESENTATION[s].mark);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it('ranks in ascending seriousness', () => {
    const ranks = Severity.options.map((s) => SEVERITY_PRESENTATION[s].rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('agrees with worstSeverity, which drives the exit code', () => {
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity([{ severity: 'advisory' }, { severity: 'critical' }])).toBe('critical');
    expect(worstSeverity([{ severity: 'serious' }, { severity: 'moderate' }])).toBe('serious');
  });
});

describe('renderer capabilities', () => {
  it('gives the static renderer no layout and no paint', () => {
    // The reason the contrast rules report unsupported by default, rather than
    // guessing from a stylesheet that was never applied.
    expect(RENDERER_CAPABILITIES.static).not.toContain('layout');
    expect(RENDERER_CAPABILITIES.static).not.toContain('paint');
    expect(RENDERER_CAPABILITIES.static).toContain('dom');
  });

  it('gives the browser renderer everything', () => {
    expect(RENDERER_CAPABILITIES.browser).toEqual(['dom', 'script', 'layout', 'paint']);
  });
});

describe('configuration', () => {
  it('defaults to the stub language provider with no network', () => {
    const result = parseEnvironment({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.language.provider).toBe('stub');
    expect(result.config.language.apiKey).toBeNull();
    expect(result.config.renderer).toBe('static');
  });

  it('does not silently upgrade to a real provider when a key is present', () => {
    // A fallback that quietly starts calling a model is how page content leaves
    // the machine without anyone deciding that it should.
    const result = parseEnvironment({ ANTHROPIC_API_KEY: 'sk-test' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.language.provider).toBe('stub');
    expect(result.warnings.join(' ')).toContain('no model will be called');
  });

  it('refuses a real provider with no key rather than falling back', () => {
    const result = parseEnvironment({ MARLO_LANGUAGE_PROVIDER: 'anthropic' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(' ')).toContain('no API key');
  });

  it('collects every problem rather than throwing on the first', () => {
    const result = parseEnvironment({ MARLO_RENDERER: 'chromium', MARLO_LOG_LEVEL: 'loud' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.length).toBeGreaterThanOrEqual(2);
  });

  it('lets overrides win over the environment', () => {
    const result = parseEnvironment({ MARLO_RENDERER: 'static' }, { renderer: 'browser' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.renderer).toBe('browser');
  });

  it('redacts the key so logging the config is safe by construction', () => {
    const parsed = MarloConfig.parse({ language: { provider: 'anthropic', apiKey: 'sk-secret' } });
    const redacted = redactConfig(parsed);
    expect(redacted.language.apiKey).toBe('[redacted]');
    expect(JSON.stringify(redacted)).not.toContain('sk-secret');
  });

  it('is constructible from nothing at all', () => {
    // Marlo has to run with zero configuration. This caught a real defect: the
    // nested `language` object had defaults on every field but none of its own,
    // so MarloConfig.parse({}) threw while each field looked correct in isolation.
    const parsed = MarloConfig.parse({});
    expect(parsed.language.provider).toBe('stub');
    expect(parsed.autoFix.minStrictPrecision).toBe(0.95);
    expect(parsed.engines).toContain('marlo');
    expect(parsed.renderer).toBe('static');
  });

  it('keeps null redacted as null rather than turning it into a string', () => {
    const parsed = MarloConfig.parse({});
    expect(redactConfig(parsed).language.apiKey).toBeNull();
  });

  it('defaults the auto-fix threshold to precision rather than recall', () => {
    // A missed violation is a gap. A wrong fix is a change to somebody's code
    // that they did not ask for. The threshold guards the second.
    const result = parseEnvironment({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.autoFix.minStrictPrecision).toBe(0.95);
    expect(result.config.autoFix.minSampleSize).toBe(6);
  });
});

describe('primitive shapes', () => {
  it('validates ACT rule ids by shape', () => {
    for (const id of ['b5c3f8', 'qt1vmo', '09o5cg']) {
      expect(ActRuleId.safeParse(id).success).toBe(true);
    }
    for (const id of ['B5C3F8', 'b5c3f', 'b5c3f88', 'b5-3f8', '']) {
      expect(ActRuleId.safeParse(id).success).toBe(false);
    }
  });

  it('validates success criteria', () => {
    expect(SuccessCriterion.safeParse('1.4.13').success).toBe(true);
    expect(SuccessCriterion.safeParse('1.4').success).toBe(false);
    expect(SuccessCriterion.safeParse('A').success).toBe(false);
  });

  it('rejects an inverted source range', () => {
    expect(
      SourceRange.safeParse({ file: 'a.html', start: 10, end: 4, line: 1, column: 1 }).success,
    ).toBe(false);
  });

  it('requires a positive line and column, since both are one-based', () => {
    expect(
      SourceRange.safeParse({ file: 'a.html', start: 0, end: 1, line: 0, column: 1 }).success,
    ).toBe(false);
  });

  it('models all four ACT outcomes', () => {
    expect(Outcome.options).toEqual(['passed', 'failed', 'cantTell', 'inapplicable']);
  });
});

describe('exit codes', () => {
  it('separates findings from an incomplete measurement', () => {
    // A script has to be able to tell "your page has problems" from "my
    // measurement did not finish". Collapsing them is how a crashed rule gets
    // treated as a clean page.
    expect(EXIT_CODES.clean).toBe(0);
    expect(EXIT_CODES.findings).toBe(1);
    expect(EXIT_CODES.usage).toBe(2);
    expect(EXIT_CODES.incomplete).toBe(3);
    expect(new Set(Object.values(EXIT_CODES)).size).toBe(Object.keys(EXIT_CODES).length);
  });
});

describe('the calibration table is validated on load', () => {
  it('rejects a schema version it does not understand', () => {
    // An unvalidated table is how a published error rate quietly becomes a
    // different number.
    expect(CalibrationTable.safeParse({ schemaVersion: 2 }).success).toBe(false);
  });

  it('rejects a timestamp where a date belongs', () => {
    // The harness has to be reproducible, so the table records a date rather than
    // the moment it happened to run.
    const minimal = { schemaVersion: 1, generated: '2026-07-29T12:00:00Z' };
    expect(CalibrationTable.safeParse(minimal).success).toBe(false);
  });
});
