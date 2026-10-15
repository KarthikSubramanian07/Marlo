import { describe, expect, it } from 'vitest';
import { buildReport, grade, renderMarkdown, wilson } from './rater-validity.mjs';

const expected = new Map([
  ['r1/c1', 'passed'],
  ['r1/c2', 'failed'],
  ['r1/c3', 'inapplicable'],
  ['r2/c4', 'failed'],
]);
const rules = [
  { id: 'r1', name: 'Rule one' },
  { id: 'r2', name: 'Rule two' },
];
const sheet = (rater, answers) => ({
  rater,
  raterKind: 'model',
  raterModel: `model-${rater}`,
  cases: Object.entries(answers).map(([k, answer]) => {
    const [ruleId, testcaseId] = k.split('/');
    return { ruleId, testcaseId, answer, note: '' };
  }),
});

describe('rater validity', () => {
  it('grades exact agreement, never counting cantTell, and failure detection', () => {
    const g = grade([
      { expected: 'failed', answer: 'failed' },
      { expected: 'failed', answer: 'cantTell' },
      { expected: 'passed', answer: 'failed' },
      { expected: 'inapplicable', answer: 'inapplicable' },
    ]);
    expect(g.agreement.successes).toBe(2);
    expect(g.agreement.n).toBe(4);
    expect(g.failurePrecision.value).toBe(0.5);
    expect(g.failureRecall.value).toBe(0.5);
    expect(g.cantTell).toBe(1);
    expect(g.confusion.failed.cantTell).toBe(1);
  });

  it('computes the Wilson interval the analysis package publishes', () => {
    expect(wilson(0, 0)).toBeNull();
    const w = wilson(8, 10);
    expect(w.low).toBeCloseTo(0.4902, 4);
    expect(w.high).toBeCloseTo(0.9433, 4);
  });

  it('adjudicates like the real pages: agreement, else the resolver', () => {
    const a = sheet('A', {
      'r1/c1': 'passed',
      'r1/c2': 'failed',
      'r1/c3': 'passed',
      'r2/c4': 'failed',
    });
    const b = sheet('B', {
      'r1/c1': 'passed',
      'r1/c2': 'failed',
      'r1/c3': 'inapplicable',
      'r2/c4': 'failed',
    });
    const resolutions = {
      resolverKind: 'model',
      resolver: 'model-C',
      resolutions: [{ ruleId: 'r1', testcaseId: 'c3', answer: 'inapplicable', reasoning: 'x' }],
    };
    const { problems, report } = buildReport({ expected, a, b, resolutions, rules });
    expect(problems).toEqual([]);
    expect(report.interRater.disagreements).toBe(1);
    expect(report.graded.A.agreement.successes).toBe(3);
    expect(report.graded.adjudicated.agreement.successes).toBe(4);
    expect(report.graded.whereResolved.cases).toBe(1);
    expect(report.perRule.find((r) => r.actRuleId === 'r1').wrongAdjudicated).toBe(0);
    const md = renderMarkdown(report);
    expect(md).toMatch(/\| \*\*Adjudicated\*\* \| 4 \| 100\.0%/);
    expect(md).toMatch(/`model-C`/);
  });

  it('refuses an unresolved disagreement, an overruled agreement and a missing case', () => {
    const a = sheet('A', { 'r1/c1': 'passed', 'r1/c2': 'failed', 'r1/c3': 'passed' });
    const b = sheet('B', {
      'r1/c1': 'passed',
      'r1/c2': 'failed',
      'r1/c3': 'failed',
      'r2/c4': 'failed',
    });
    const resolutions = {
      resolverKind: 'model',
      resolver: 'model-C',
      resolutions: [{ ruleId: 'r1', testcaseId: 'c1', answer: 'failed', reasoning: 'x' }],
    };
    const problems = buildReport({ expected, a, b, resolutions, rules }).problems.join('\n');
    expect(problems).toMatch(/A\.json: r2\/c4 is missing/);
    expect(problems).toMatch(/r1\/c1 overrules two raters who agreed/);
    expect(problems).toMatch(/r1\/c3 is a disagreement with no resolution/);
  });

  it('refuses a rater whose kind or model is not named', () => {
    const a = {
      ...sheet('A', Object.fromEntries([...expected].map(([k, v]) => [k, v]))),
      raterKind: null,
    };
    const b = {
      ...sheet('B', Object.fromEntries([...expected].map(([k, v]) => [k, v]))),
      raterModel: '',
    };
    const problems = buildReport({ expected, a, b, resolutions: null, rules }).problems.join('\n');
    expect(problems).toMatch(/A\.json: raterKind is not set/);
    expect(problems).toMatch(/B\.json: no raterModel/);
  });
});
