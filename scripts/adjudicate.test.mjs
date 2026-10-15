import { describe, expect, it } from 'vitest';
import { IMPLEMENTED_RULES } from '@marlo/rules';
import {
  PRESCREEN,
  buildSheet,
  cohensKappa,
  pairSheets,
  prescreenSource,
  prescreened,
  renderDisagreements,
  resolveCells,
  seededShuffle,
  validateSheet,
} from './adjudicate.mjs';

/** n copies of a pair, for building a contingency table by hand. */
const times = (n, pair) => Array.from({ length: n }, () => pair);

describe("Cohen's kappa", () => {
  it('matches a hand-computed two by two table', () => {
    // 50 items. A and B both yes on 20, A yes B no on 5, A no B yes on 10, both no on 15.
    // po = 35 / 50 = 0.70. A says yes on 25 of 50, B on 30 of 50, so
    // pe = 0.5 * 0.6 + 0.5 * 0.4 = 0.50, and kappa = (0.70 - 0.50) / (1 - 0.50) = 0.40.
    const pairs = [
      ...times(20, ['yes', 'yes']),
      ...times(5, ['yes', 'no']),
      ...times(10, ['no', 'yes']),
      ...times(15, ['no', 'no']),
    ];
    const { percentAgreement, kappa } = cohensKappa(pairs);
    expect(percentAgreement).toBeCloseTo(0.7, 12);
    expect(kappa).toBeCloseTo(0.4, 12);
  });

  it('matches a hand-computed table over the four ACT outcomes', () => {
    // 10 cells. Agreements: passed 3, failed 2, inapplicable 2. Disagreements: A failed
    // B cantTell, A cantTell B passed, A passed B inapplicable. po = 7 / 10.
    // A marginals: passed 4, failed 3, cantTell 1, inapplicable 2.
    // B marginals: passed 4, failed 2, cantTell 1, inapplicable 3.
    // pe = (16 + 6 + 1 + 6) / 100 = 0.29. kappa = (0.7 - 0.29) / 0.71 = 0.41 / 0.71.
    const pairs = [
      ...times(3, ['passed', 'passed']),
      ...times(2, ['failed', 'failed']),
      ...times(2, ['inapplicable', 'inapplicable']),
      ['failed', 'cantTell'],
      ['cantTell', 'passed'],
      ['passed', 'inapplicable'],
    ];
    const { percentAgreement, kappa } = cohensKappa(pairs);
    expect(percentAgreement).toBeCloseTo(0.7, 12);
    expect(kappa).toBeCloseTo(0.41 / 0.71, 12);
  });

  it('is undefined, not zero, with nothing to compare', () => {
    expect(cohensKappa([])).toEqual({ percentAgreement: null, kappa: null });
  });

  it('is undefined when both raters gave one identical answer throughout', () => {
    // Agreement is total and chance agreement is total, so kappa is 0 / 0. Printing 1
    // would claim a reliability nothing measured.
    expect(cohensKappa(times(8, ['passed', 'passed']))).toEqual({
      percentAgreement: 1,
      kappa: null,
    });
  });

  it('is 1 for perfect agreement with more than one answer', () => {
    expect(
      cohensKappa([...times(3, ['failed', 'failed']), ...times(2, ['passed', 'passed'])]).kappa,
    ).toBe(1);
  });

  it('is 0 when one rater never varies', () => {
    // A always says passed; B splits evenly. po = 0.5 and pe = 1 * 0.5 = 0.5.
    const { kappa } = cohensKappa([
      ...times(4, ['passed', 'passed']),
      ...times(4, ['passed', 'failed']),
    ]);
    expect(kappa).toBe(0);
  });

  it('goes negative when raters disagree more than chance', () => {
    const { percentAgreement, kappa } = cohensKappa([
      ...times(5, ['passed', 'failed']),
      ...times(5, ['failed', 'passed']),
    ]);
    expect(percentAgreement).toBe(0);
    expect(kappa).toBe(-1);
  });
});

describe('the pre-screen', () => {
  it('has an entry, written out, for every rule Marlo implements and nothing else', () => {
    expect(Object.keys(PRESCREEN).sort()).toEqual([...IMPLEMENTED_RULES].sort());
  });

  it('refuses a rule it has no entry for rather than skipping it', () => {
    expect(() => prescreened('zzzzzz', '<p>')).toThrow(/no entry/);
  });

  it('marks a cell inapplicable only on element absence', () => {
    expect(prescreened('cae760', '<p>no frames here</p>')).toBe(true);
    expect(prescreened('cae760', '<IFRAME src="x"></IFRAME>')).toBe(false);
  });

  it('never pre-screens a rule that applies to every page', () => {
    expect(prescreened('2779a5', '')).toBe(false);
  });

  it('ignores elements named only in comments and stylesheets', () => {
    const source = prescreenSource('<!-- <iframe> --><style>iframe { border: 0 }</style><p>');
    expect(prescreened('cae760', source)).toBe(true);
  });
});

describe('worksheets', () => {
  const pages = [
    { id: 'shop-01', category: 'shop', path: 'pages/shop-01/index.html' },
    { id: 'form-01', category: 'form', path: 'pages/form-01/index.html' },
  ];
  const rules = [
    { id: 'cae760', name: 'Iframe element has non-empty accessible name' },
    { id: '2779a5', name: 'HTML page has non-empty title' },
  ];
  const read = (page) => (page.id === 'shop-01' ? '<title>x</title>' : '<iframe></iframe>');
  const expected = new Set(pages.flatMap((p) => rules.map((r) => `${p.id}/${r.id}`)));

  it('shuffles deterministically, differently per rater', () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    expect(seededShuffle(items, 'A')).toEqual(seededShuffle(items, 'A'));
    expect(seededShuffle(items, 'A')).not.toEqual(seededShuffle(items, 'B'));
    expect([...seededShuffle(items, 'B')].sort((x, y) => x - y)).toEqual(items);
  });

  it('carries no engine output, only the page, the rule and an empty answer', () => {
    const sheet = buildSheet('A', pages, rules, read);
    expect(sheet.cells).toHaveLength(4);
    for (const cell of sheet.cells) {
      expect(Object.keys(cell).sort()).toEqual(
        [
          'answer',
          'category',
          'file',
          'note',
          'page',
          'prescreened',
          'rule',
          'ruleName',
          'ruleUrl',
        ].sort(),
      );
    }
    const screened = sheet.cells.filter((c) => c.prescreened);
    expect(screened.map((c) => `${c.page}/${c.rule}`)).toEqual(['shop-01/cae760']);
    expect(screened[0].answer).toBe('inapplicable');
    expect(validateSheet(sheet, expected)).toEqual([]);
  });

  it('refuses an unknown rater', () => {
    expect(() => buildSheet('C', pages, rules, read)).toThrow(/rater/);
  });

  it('names who answered once anything is answered, and the model for a model rater', () => {
    const sheet = buildSheet('A', pages, rules, read);
    expect(sheet.raterKind).toBeNull();
    const cell = sheet.cells.find((c) => !c.prescreened);
    cell.answer = 'passed';
    expect(validateSheet(sheet, expected).join('\n')).toMatch(/raterKind is not set/);
    sheet.raterKind = 'model';
    expect(validateSheet(sheet, expected).join('\n')).toMatch(/must name the model/);
    sheet.raterModel = 'claude-opus-5-5';
    expect(validateSheet(sheet, expected)).toEqual([]);
    sheet.raterKind = 'person';
    expect(validateSheet(sheet, expected).join('\n')).toMatch(/not a model/);
    sheet.raterModel = null;
    expect(validateSheet(sheet, expected)).toEqual([]);
    sheet.raterKind = 'robot';
    expect(validateSheet(sheet, expected).join('\n')).toMatch(/raterKind "robot"/);
  });

  it('requires a note with failed and cantTell', () => {
    const sheet = buildSheet('A', pages, rules, read);
    sheet.raterKind = 'person';
    sheet.cells[0].answer = 'cantTell';
    expect(validateSheet(sheet, expected).join('\n')).toMatch(/needs a note/);
    sheet.cells[0].note = 'The label is an icon whose meaning depends on context.';
    expect(validateSheet(sheet, expected)).toEqual([]);
  });

  it('reports missing, duplicated, foreign and malformed cells', () => {
    const sheet = buildSheet('B', pages, rules, read);
    const [first, ...rest] = sheet.cells;
    const problems = validateSheet(
      { rater: 'Z', cells: [...rest, rest[0], { ...first, page: 'news-99', answer: 'maybe' }] },
      expected,
    ).join('\n');
    expect(problems).toMatch(/not A or B/);
    expect(problems).toMatch(/appears twice/);
    expect(problems).toMatch(/not a cell of this corpus/);
    expect(problems).toMatch(/is not one of/);
    expect(problems).toMatch(/missing/);
    expect(validateSheet(null, expected)).toEqual(['not a worksheet: no cells array']);
  });
});

describe('agreement and resolution', () => {
  const cell = (page, rule, answer, extra = {}) => ({
    page,
    rule,
    answer,
    prescreened: false,
    note: answer === 'failed' || answer === 'cantTell' ? 'reason' : '',
    ruleName: 'Rule',
    ...extra,
  });
  const screened = (page, rule) => cell(page, rule, 'inapplicable', { prescreened: true });

  const a = {
    rater: 'A',
    cells: [
      cell('p1', 'r1', 'passed'),
      cell('p1', 'r2', 'failed'),
      screened('p1', 'r3'),
      cell('p2', 'r1', null),
      screened('p2', 'r3'),
    ],
  };
  const b = {
    rater: 'B',
    cells: [
      cell('p1', 'r1', 'passed'),
      cell('p1', 'r2', 'cantTell'),
      screened('p1', 'r3'),
      cell('p2', 'r1', 'passed'),
      screened('p2', 'r3'),
    ],
  };

  it('computes agreement over rated cells only', () => {
    const paired = pairSheets(a, b);
    expect(paired.rated.map((c) => c.key)).toEqual(['p1/r1', 'p1/r2']);
    expect(paired.prescreen.map((c) => c.key)).toEqual(['p1/r3', 'p2/r3']);
    expect(paired.pending).toEqual(['p2/r1']);
    expect(paired.disagreements.map((c) => c.key)).toEqual(['p1/r2']);
  });

  it('counts a pre-screen one rater overrode as rated', () => {
    const overridden = {
      ...b,
      cells: b.cells.map((c) =>
        c.rule === 'r3' && c.page === 'p1' ? cell('p1', 'r3', 'failed') : c,
      ),
    };
    const paired = pairSheets(a, overridden);
    expect(paired.disagreements.map((c) => c.key)).toContain('p1/r3');
  });

  it('refuses a disagreement nobody resolved', () => {
    const { problems } = resolveCells(a, b, []);
    expect(problems.join('\n')).toMatch(/p1\/r2: A said failed, B said cantTell/);
  });

  it('refuses a resolution without a resolver or reasoning', () => {
    const { problems } = resolveCells(a, b, [
      { page: 'p1', rule: 'r2', answer: 'failed', resolver: '', reasoning: '' },
    ]);
    expect(problems.join('\n')).toMatch(/names no resolver/);
    expect(problems.join('\n')).toMatch(/resolverKind is not one of/);
    expect(problems.join('\n')).toMatch(/gives no reasoning/);
  });

  it('refuses a resolution that overrules two raters who agreed', () => {
    const { problems } = resolveCells(a, b, [
      {
        page: 'p1',
        rule: 'r2',
        answer: 'failed',
        resolver: 'C',
        resolverKind: 'person',
        reasoning: 'The control has no name.',
      },
      {
        page: 'p1',
        rule: 'r1',
        answer: 'failed',
        resolver: 'C',
        resolverKind: 'person',
        reasoning: 'Changed my mind.',
      },
    ]);
    expect(problems.join('\n')).toMatch(/p1\/r1: the raters did not disagree/);
  });

  it('merges agreements, resolutions and finished-page pre-screens, and leaves the rest out', () => {
    const { cells, problems, pending } = resolveCells(a, b, [
      {
        page: 'p1',
        rule: 'r2',
        answer: 'failed',
        resolver: 'C',
        resolverKind: 'person',
        reasoning: 'The control has no name.',
      },
    ]);
    expect(problems).toEqual([]);
    expect(pending).toBe(1);
    expect(cells).toEqual([
      { page: 'p1', rule: 'r1', answer: 'passed', source: 'agreement' },
      {
        page: 'p1',
        rule: 'r2',
        answer: 'failed',
        source: 'resolution',
        resolver: 'C',
        resolverKind: 'person',
        reasoning: 'The control has no name.',
      },
      { page: 'p1', rule: 'r3', answer: 'inapplicable', source: 'prescreen' },
    ]);
    // p2/r3 is pre-screened but p2 is unfinished for rater A, so it is not resolved yet.
  });

  it('writes every disagreement into the log, resolved or not', () => {
    const paired = pairSheets(a, b);
    const open = renderDisagreements(paired, [], new Map([['p1', 'shop (0123456789ab)']]));
    expect(open).toMatch(/## shop \(0123456789ab\), rule r2/);
    expect(open).toMatch(/Rater A: \*\*failed\*\*. reason/);
    expect(open).toMatch(/\*\*unresolved\*\*/);
    const closed = renderDisagreements(
      paired,
      [{ page: 'p1', rule: 'r2', answer: 'failed', resolver: 'C', reasoning: 'No name.' }],
      new Map(),
    );
    expect(closed).toMatch(/Resolution: \*\*failed\*\*, by C. No name./);
    expect(renderDisagreements(pairSheets(a, a), [], new Map())).toMatch(/No disagreements yet/);
  });
});
