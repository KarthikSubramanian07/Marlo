import { describe, expect, it } from 'vitest';
import { buildReport, collapse, renderMarkdown, summarise } from './error-analysis.mjs';

const cell = (outcome) => ({
  status: 'ok',
  outcome,
  elements: 1,
  evidence: [{ selector: 'a', message: `${outcome} message` }],
});
const resolved = {
  cells: [
    { page: 'p1', rule: 'r1', answer: 'passed', source: 'agreement' },
    { page: 'p2', rule: 'r1', answer: 'failed', source: 'agreement' },
    { page: 'p1', rule: 'r2', answer: 'failed', source: 'resolution' },
    { page: 'p2', rule: 'r2', answer: 'cantTell', source: 'resolution' },
  ],
};
const sheets = {
  A: { cells: resolved.cells.map((c) => ({ ...c, note: `A on ${c.page}` })) },
  B: { cells: resolved.cells.map((c) => ({ ...c, note: `B on ${c.page}` })) },
};
const strict = (tp, fp, fn) => ({ truePositives: tp, falsePositives: fp, falseNegatives: fn });
const table = (r1, r2) => ({
  entries: [{ engine: 'marlo', actRuleId: 'r1', strict: strict(0, 0, 0) }],
  realCorpus: {
    entries: [
      { engine: 'marlo', actRuleId: 'r1', graded: { strict: r1 } },
      { engine: 'marlo', actRuleId: 'r2', graded: { strict: r2 } },
      { engine: 'axe-core', actRuleId: 'r1', graded: { strict: strict(9, 9, 9) } },
    ],
  },
});
const causes = [
  {
    id: 'fp-r1',
    family: 'rule logic',
    kind: 'FP',
    match: (r) => r.rule === 'r1',
    title: 'T1',
    detail: 'D1',
  },
  { id: 'fn-any', family: 'abstention', kind: 'FN', match: () => true, title: 'T2', detail: 'D2' },
];
const verdicts = {
  static: {
    'p1/r1': cell('failed'),
    'p2/r1': cell('failed'),
    'p1/r2': cell('cantTell'),
    'p2/r2': cell('passed'),
  },
  browser: {
    'p1/r1': cell('passed'),
    'p2/r1': cell('failed'),
    'p1/r2': cell('failed'),
    'p2/r2': cell('passed'),
  },
};

describe('error analysis', () => {
  it('collapses verdicts the way the engines do', () => {
    expect(collapse([])).toBe('inapplicable');
    expect(collapse([{ outcome: 'passed' }, { outcome: 'cantTell' }])).toBe('cantTell');
    expect(collapse([{ outcome: 'cantTell' }, { outcome: 'failed' }])).toBe('failed');
  });

  it('keeps only the verdicts behind the outcome', () => {
    const s = summarise({
      status: 'ok',
      verdicts: [
        { outcome: 'passed', target: { selector: 'b' }, message: 'fine' },
        { outcome: 'failed', target: { selector: 'a' }, message: 'bad' },
      ],
    });
    expect(s).toEqual({
      status: 'ok',
      outcome: 'failed',
      elements: 2,
      evidence: [{ selector: 'a', message: 'bad' }],
    });
    expect(summarise({ status: 'unsupported', verdicts: [] }).outcome).toBeNull();
  });

  it('names every wrong cell, its cause, and what the browser run says', () => {
    const { problems, report } = buildReport({
      verdicts,
      resolved,
      sheets,
      resolutions: { resolutions: [] },
      table: table(strict(1, 1, 0), strict(0, 0, 1)),
      causes,
    });
    expect(problems).toEqual([]);
    expect(report.gradedCells).toBe(3);
    expect(report.falsePositives).toBe(1);
    expect(report.falseNegatives).toBe(1);
    expect(report.errors.map((e) => [e.kind, e.page, e.rule, e.cause, e.browser])).toEqual([
      ['FN', 'p1', 'r2', 'fn-any', 'failed'],
      ['FP', 'p1', 'r1', 'fp-r1', 'passed'],
    ]);
    expect(report.byCause.every((c) => c.browserCorrects === 1)).toBe(true);
    expect(report.byCause.find((c) => c.id === 'fp-r1').rulesPerfectOnAct).toEqual(['r1']);
    expect(report.graded.browser.precision.value).toBe(1);
    const md = renderMarkdown(report);
    expect(md).toMatch(/\| FP \| r1 \| p1 \| passed \| failed \| passed \| fp-r1 \|/);
    expect(md).toMatch(/failed \(resolved\)/);
  });

  it('refuses verdicts that no longer reproduce the calibration table', () => {
    const { problems } = buildReport({
      verdicts,
      resolved,
      sheets,
      resolutions: null,
      table: table(strict(1, 0, 0), strict(0, 0, 1)),
      causes,
    });
    expect(problems.join('\n')).toMatch(/r1: falsePositives is 1 here and 0 in calibration/);
  });

  it('refuses a wrong cell with no cause, or with two', () => {
    const none = buildReport({
      verdicts,
      resolved,
      sheets,
      resolutions: null,
      table: table(strict(1, 1, 0), strict(0, 0, 1)),
      causes: causes.slice(0, 1),
    }).problems.join('\n');
    expect(none).toMatch(/FN p1\/r2 \(cantTell, truth failed\) matches 0 causes/);
    const two = buildReport({
      verdicts,
      resolved,
      sheets,
      resolutions: null,
      table: table(strict(1, 1, 0), strict(0, 0, 1)),
      causes: [...causes, { ...causes[0], id: 'again' }],
    }).problems.join('\n');
    expect(two).toMatch(/matches 2 causes: fp-r1, again/);
  });
});
