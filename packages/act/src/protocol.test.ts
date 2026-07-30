import { describe, expect, it } from 'vitest';
import type { ExpectedOutcome, Outcome } from '@marlo/schema';
import { FLATTERY_RECALL_THRESHOLD } from '@marlo/schema';

import type { GradedCase } from './protocol.js';
import {
  automationOf,
  consistencyOf,
  disallowedCount,
  isAllowed,
  isFlatteredByProtocol,
  outcomeMatrixOf,
} from './protocol.js';
import { strictAccuracyOf } from './accuracy.js';

/**
 * The grading protocol is where every accuracy number Marlo publishes comes from,
 * so these tests are written against the specification text rather than against the
 * implementation.
 *
 * The most important test in this file is "the protocol calls a tool that answers
 * cantTell everywhere a correct implementation". That is not a curiosity: it is the
 * finding that produced DECISIONS.md D-004 and the reason the calibration table has
 * two views. If that test ever fails, the protocol changed and the table's meaning
 * changed with it.
 */

const graded = (expected: ExpectedOutcome, actual: Outcome | null): GradedCase => ({
  expected,
  actual,
});

const ALL_OUTCOMES: readonly Outcome[] = ['passed', 'failed', 'cantTell', 'inapplicable'];
const ALL_EXPECTED: readonly ExpectedOutcome[] = ['passed', 'failed', 'inapplicable'];

describe('isAllowed', () => {
  it('follows the published table for passed examples', () => {
    expect(isAllowed('passed', 'passed')).toBe(true);
    expect(isAllowed('passed', 'cantTell')).toBe(true);
    expect(isAllowed('passed', 'inapplicable')).toBe(true);
    expect(isAllowed('passed', 'failed')).toBe(false);
  });

  it('follows the published table for failed examples', () => {
    expect(isAllowed('failed', 'failed')).toBe(true);
    expect(isAllowed('failed', 'cantTell')).toBe(true);
    expect(isAllowed('failed', 'passed')).toBe(false);
    expect(isAllowed('failed', 'inapplicable')).toBe(false);
  });

  it('follows the published table for inapplicable examples', () => {
    expect(isAllowed('inapplicable', 'inapplicable')).toBe(true);
    expect(isAllowed('inapplicable', 'cantTell')).toBe(true);
    expect(isAllowed('inapplicable', 'passed')).toBe(true);
    expect(isAllowed('inapplicable', 'failed')).toBe(false);
  });

  it('never allows a case that did not run', () => {
    // The protocol has no entry for "did not run": it assumes a tool that was
    // asked a question answered it. Treating a crash as permitted would let a
    // broken implementation grade as consistent, which is exactly the failure the
    // sibling PDF project shipped.
    for (const expected of ALL_EXPECTED) {
      expect(isAllowed(expected, null)).toBe(false);
    }
  });

  it('is exhaustive over every expected and actual pairing', () => {
    // Twelve combinations. Enumerated so a widened Outcome union cannot slip
    // through with undefined behaviour.
    let allowedCount = 0;
    for (const expected of ALL_EXPECTED) {
      for (const actual of ALL_OUTCOMES) {
        if (isAllowed(expected, actual)) allowedCount += 1;
      }
    }
    // 3 for passed, 2 for failed, 3 for inapplicable.
    expect(allowedCount).toBe(8);
  });
});

describe('consistencyOf', () => {
  it('reports unmapped when nothing was evaluated', () => {
    // Distinct from `incorrect`. Conflating them would punish an engine for
    // honestly having no opinion about a rule.
    expect(consistencyOf([])).toBe('unmapped');
  });

  it('reports consistent when every outcome is allowed', () => {
    expect(
      consistencyOf([
        graded('passed', 'passed'),
        graded('failed', 'failed'),
        graded('inapplicable', 'inapplicable'),
      ]),
    ).toBe('consistent');
  });

  it('reports partial when only some failing examples are missed', () => {
    // The protocol's asymmetry: a missed violation is incomplete, a false positive
    // is disqualifying. That matches how the two cost a developer.
    expect(
      consistencyOf([
        graded('passed', 'passed'),
        graded('failed', 'failed'),
        graded('failed', 'passed'),
        graded('inapplicable', 'inapplicable'),
      ]),
    ).toBe('partial');
  });

  it('reports incorrect when a passing example is flagged', () => {
    expect(consistencyOf([graded('passed', 'failed'), graded('failed', 'failed')])).toBe(
      'incorrect',
    );
  });

  it('reports incorrect when an inapplicable example is flagged', () => {
    expect(consistencyOf([graded('inapplicable', 'failed')])).toBe('incorrect');
  });

  it('prefers incorrect over partial when both apply', () => {
    // A false positive outranks a miss. An implementation that does both is
    // incorrect, and reporting it as partial would understate the problem.
    expect(consistencyOf([graded('passed', 'failed'), graded('failed', 'passed')])).toBe(
      'incorrect',
    );
  });

  it('reports incorrect when a case crashed', () => {
    // A crash is not an allowed outcome, so it is disallowed like any other. This
    // is the sibling project's principle: a check that failed to run must never be
    // indistinguishable from a check that found nothing.
    expect(consistencyOf([graded('passed', null)])).toBe('incorrect');
    expect(consistencyOf([graded('failed', null)])).toBe('partial');
  });

  it('excludes a case the environment could not evaluate, but not a crash', () => {
    // A crash is a defect in the implementation and the protocol holds it against it. An
    // unsupported case means the measurement was never taken: the renderer could not
    // represent the document, or lacked a capability the rule needs.
    //
    // This distinction was found by the first calibration run. Every engine, including
    // Marlo's, graded `incorrect` on b5c3f8 because the rule's two inapplicable examples
    // have an svg and a math root element, which document.write wraps in an html
    // element. Four independent engines failing identically is a harness defect, not four
    // coincidences. Counting those cases recorded a false positive against all four for a
    // defect none of them had.
    const unsupported: GradedCase[] = [
      graded('failed', 'failed'),
      { expected: 'inapplicable', actual: null, unsupported: true },
    ];
    expect(consistencyOf(unsupported)).toBe('consistent');
    expect(disallowedCount(unsupported)).toBe(0);

    const crashed: GradedCase[] = [
      graded('failed', 'failed'),
      { expected: 'inapplicable', actual: null, errored: true },
    ];
    expect(consistencyOf(crashed)).toBe('incorrect');
    expect(disallowedCount(crashed)).toBe(1);
  });

  it('is unmapped when every case was unevaluable', () => {
    // Nothing was measured, so there is no verdict to give. Reporting `consistent`
    // because nothing contradicted it would be the flattery this project argues against.
    expect(
      consistencyOf([
        { expected: 'failed', actual: null, unsupported: true },
        { expected: 'passed', actual: null, unsupported: true },
      ]),
    ).toBe('unmapped');
    expect(automationOf([{ expected: 'failed', actual: null, unsupported: true }])).toBe(
      'not-applicable',
    );
  });

  it('calls a tool that answers cantTell everywhere a correct implementation', () => {
    // THE test in this file. cantTell is allowed for every example type, so an
    // implementation that never commits grades as consistent under the official
    // protocol while telling a developer nothing.
    //
    // This is not a bug in the protocol: it grades whether a tool misleads, and a
    // tool saying "I do not know" has misled nobody. It is the wrong question for
    // a developer, and it is why the calibration table publishes a strict view
    // alongside the official one. DECISIONS.md D-004.
    const alwaysUnsure: GradedCase[] = [
      ...Array.from({ length: 10 }, () => graded('passed', 'cantTell')),
      ...Array.from({ length: 10 }, () => graded('failed', 'cantTell')),
      ...Array.from({ length: 10 }, () => graded('inapplicable', 'cantTell')),
    ];

    expect(consistencyOf(alwaysUnsure)).toBe('consistent');
    expect(disallowedCount(alwaysUnsure)).toBe(0);

    // And the strict view, which is the number a user experiences.
    const strict = strictAccuracyOf(alwaysUnsure);
    expect(strict.recall).toBe(0);
    expect(strict.truePositives).toBe(0);
    expect(strict.falseNegatives).toBe(10);
    expect(strict.cantTellOnFailed).toBe(10);

    // The two views disagree, and the gap is computed rather than left to a reader.
    expect(
      isFlatteredByProtocol(consistencyOf(alwaysUnsure), strict.recall, FLATTERY_RECALL_THRESHOLD),
    ).toBe(true);
  });
});

describe('automationOf', () => {
  it('is automated when nothing is cantTell', () => {
    expect(automationOf([graded('passed', 'passed'), graded('failed', 'failed')])).toBe(
      'automated',
    );
  });

  it('drops to semi-automated on a single cantTell', () => {
    // "Consistent and semi-automated" and "consistent and automated" describe very
    // different products, and the published implementation reports show only the
    // first word.
    expect(automationOf([graded('passed', 'passed'), graded('failed', 'cantTell')])).toBe(
      'semi-automated',
    );
  });

  it('is not-applicable when nothing was evaluated', () => {
    expect(automationOf([])).toBe('not-applicable');
  });
});

describe('disallowedCount', () => {
  it('counts every case the protocol does not permit', () => {
    // Published alongside the verdict because `incorrect` on one case out of
    // thirty and `incorrect` on twenty-nine are the same word.
    expect(
      disallowedCount([
        graded('passed', 'failed'),
        graded('failed', 'passed'),
        graded('failed', 'failed'),
        graded('inapplicable', null),
      ]),
    ).toBe(3);
  });

  it('is zero for a consistent implementation', () => {
    expect(disallowedCount([graded('passed', 'passed'), graded('failed', 'cantTell')])).toBe(0);
  });
});

describe('isFlatteredByProtocol', () => {
  it('is false unless the official verdict is consistent', () => {
    for (const consistency of ['partial', 'incorrect', 'unmapped'] as const) {
      expect(isFlatteredByProtocol(consistency, 0.1, 0.5)).toBe(false);
    }
  });

  it('is false when recall was never measured', () => {
    // Null recall means the rule has no failing examples, so there was nothing to
    // recall. An absent measurement is not flattery.
    expect(isFlatteredByProtocol('consistent', null, 0.5)).toBe(false);
  });

  it('is true when consistent and strict recall is below the threshold', () => {
    expect(isFlatteredByProtocol('consistent', 0.49, 0.5)).toBe(true);
    expect(isFlatteredByProtocol('consistent', 0.5, 0.5)).toBe(false);
    expect(isFlatteredByProtocol('consistent', 0.9, 0.5)).toBe(false);
  });
});

describe('outcomeMatrixOf', () => {
  it('counts every outcome against every expectation', () => {
    const matrix = outcomeMatrixOf([
      graded('passed', 'passed'),
      graded('passed', 'passed'),
      graded('passed', 'cantTell'),
      graded('failed', 'failed'),
      graded('failed', 'passed'),
      graded('inapplicable', 'inapplicable'),
    ]);

    expect(matrix.passed.passed).toBe(2);
    expect(matrix.passed.cantTell).toBe(1);
    expect(matrix.passed.failed).toBe(0);
    expect(matrix.failed.failed).toBe(1);
    expect(matrix.failed.passed).toBe(1);
    expect(matrix.inapplicable.inapplicable).toBe(1);
  });

  it('keeps crashes and unsupported rules out of every outcome bucket', () => {
    // Both are counted separately so the denominator stays honest. Folding either
    // into an outcome is how an engine that never ran looks like an engine that
    // found nothing.
    const matrix = outcomeMatrixOf([
      { expected: 'failed', actual: null, errored: true },
      { expected: 'failed', actual: null, unsupported: true },
      graded('failed', 'failed'),
    ]);

    expect(matrix.errored).toBe(1);
    expect(matrix.unsupported).toBe(1);
    expect(matrix.failed.failed).toBe(1);
    // Two cases produced no outcome at all, so the row sums to one, not three.
    const failedRow = Object.values(matrix.failed).reduce((a, b) => a + b, 0);
    expect(failedRow).toBe(1);
  });

  it('returns a zeroed matrix for no cases', () => {
    const matrix = outcomeMatrixOf([]);
    for (const row of [matrix.passed, matrix.failed, matrix.inapplicable]) {
      expect(Object.values(row).reduce((a, b) => a + b, 0)).toBe(0);
    }
    expect(matrix.errored).toBe(0);
    expect(matrix.unsupported).toBe(0);
  });
});
