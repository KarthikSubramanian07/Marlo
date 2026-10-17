import { describe, expect, it } from 'vitest';
import type { CalibrationEntry, CalibrationTable, EngineId, Outcome } from '@trymarlo/schema';
import { analyse, collectCases, routeFrom, wilson, type CaseRecord } from './analysis.js';

/**
 * The analysis that replaces in-sample routing figures with held-out ones. The scenario at
 * its centre is the one that made the in-sample figure perfect: an engine the router refuses
 * because of a single false positive is chosen as soon as that case is held out, and then it
 * commits that false positive on the case it was not allowed to see.
 */

function entry(engine: EngineId, actRuleId = '23a2a8'): CalibrationEntry {
  return {
    actRuleId,
    engine,
    engineVersion: '1.0.0',
    engineRuleIds: ['x'],
    mappingKind: 'exact',
    testCaseCount: 6,
    matrix: {
      passed: { passed: 0, failed: 0, cantTell: 0, inapplicable: 0 },
      failed: { passed: 0, failed: 0, cantTell: 0, inapplicable: 0 },
      inapplicable: { passed: 0, failed: 0, cantTell: 0, inapplicable: 0 },
      errored: 0,
      unsupported: 0,
    },
    act: { consistency: 'consistent', automation: 'automated', disallowed: 0 },
    strict: {
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      trueNegatives: 0,
      cantTellOnFailed: 0,
      cantTellOnPassed: 0,
      precision: null,
      recall: null,
      f1: null,
      falsePositiveRate: null,
    },
    flatteredByProtocol: false,
  };
}

function table(overrides: Partial<CalibrationTable> = {}): CalibrationTable {
  return {
    schemaVersion: 1,
    generated: '2026-10-13',
    commit: null,
    corpus: { retrieved: '2026-07-29', rules: 94, rulesWithTestCases: 91, testCases: 1134 },
    engines: [],
    renderer: 'static',
    entries: [entry('marlo'), entry('axe-core')],
    // What the table publishes: Marlo flagged a passing case, so it is `incorrect` and the
    // router chose axe-core.
    routing: [
      {
        actRuleId: '23a2a8',
        chosen: 'axe-core',
        reason: 'best-measured',
        candidates: [],
        autoFixPermitted: false,
      },
    ],
    autoFixThreshold: { minStrictPrecision: 0.95, minSampleSize: 6, rationale: 'x' },
    coverage: {
      implemented: 1,
      publishedActRules: 94,
      calibratable: 1,
      implementedButUnmeasurable: [],
    },
    aggregate: {
      strictPrecision: null,
      strictRecall: null,
      falsePositiveRate: null,
      sampleSize: 0,
    },
    ...overrides,
  };
}

function record(
  path: string,
  expected: 'passed' | 'failed' | 'inapplicable',
  marlo: Outcome | null,
  axe: Outcome | null,
): CaseRecord {
  return { actRuleId: '23a2a8', path, expected, actual: { marlo, 'axe-core': axe } };
}

// Marlo finds every failure and flags one passing case. axe-core misses one failure and
// flags nothing.
const CASES: CaseRecord[] = [
  record('f1', 'failed', 'failed', 'failed'),
  record('f2', 'failed', 'failed', 'failed'),
  record('f3', 'failed', 'failed', 'passed'),
  record('p1', 'passed', 'failed', 'passed'),
  record('p2', 'passed', 'passed', 'passed'),
  record('p3', 'passed', 'passed', 'passed'),
];

describe('wilson', () => {
  it('matches the textbook interval', () => {
    const p = wilson(8, 10);
    expect(p?.value).toBe(0.8);
    expect(p?.low).toBeCloseTo(0.4902, 3);
    expect(p?.high).toBeCloseTo(0.9433, 3);
  });

  it('stays inside zero and one at the extremes, and is undefined with no trials', () => {
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(0, 5)?.low).toBe(0);
    expect(wilson(5, 5)?.high).toBe(1);
    expect(wilson(5, 5)?.low).toBeLessThan(1);
  });
});

describe('collectCases', () => {
  it('folds one observation per engine into one record per case', () => {
    const cases = collectCases([
      { actRuleId: '23a2a8', engine: 'marlo', path: 'a', expected: 'failed', actual: 'failed' },
      { actRuleId: '23a2a8', engine: 'axe-core', path: 'a', expected: 'failed', actual: null },
      { actRuleId: '23a2a8', engine: 'marlo', path: 'b', expected: 'passed', actual: 'passed' },
    ]);
    expect(cases).toHaveLength(2);
    expect(cases[0]?.actual).toEqual({ marlo: 'failed', 'axe-core': null });
  });
});

describe('routeFrom', () => {
  it('uses the table routing function on whichever cases it is given', () => {
    expect(routeFrom(table(), '23a2a8', CASES)).toBe('axe-core');
    // Without the passing case Marlo flagged, Marlo is consistent and finds more.
    expect(
      routeFrom(
        table(),
        '23a2a8',
        CASES.filter((c) => c.path !== 'p1'),
      ),
    ).toBe('marlo');
  });
});

describe('analyse', () => {
  const report = analyse({ table: table(), cases: CASES, implementedRules: ['23a2a8'] });
  const scan = report.scopes.find((s) => s.id === 'scan');
  const strategy = (id: string) => scan?.strategies.find((s) => s.id === id);

  it('shows the in-sample routing as perfect and the held-out routing as not', () => {
    expect(strategy('routed-in-sample')?.falsePositives).toBe(0);
    expect(strategy('routed-in-sample')?.precision?.value).toBe(1);
    // Holding p1 out lets Marlo be chosen, and Marlo flags p1.
    expect(strategy('routed-held-out')?.falsePositives).toBe(1);
    expect(report.routingStability.casesWhereChoiceChanges).toBe(1);
    expect(report.routingStability.rulesWhereChoiceChanges).toEqual(['23a2a8']);
  });

  it('measures what marlo scan reports as the union of the engines failures', () => {
    const output = strategy('scan-output');
    expect(output?.truePositives).toBe(3);
    expect(output?.falsePositives).toBe(1);
    expect(output?.falseNegatives).toBe(0);
  });

  it('scores single engines and the majority', () => {
    expect(strategy('single-axe-core')?.falseNegatives).toBe(1);
    expect(strategy('single-marlo')?.falsePositives).toBe(1);
    expect(strategy('majority')?.truePositives).toBe(2);
    expect(strategy('single-alfa')?.truePositives).toBe(0);
  });

  it('leaves out a case no engine answered, and a rule nobody routes', () => {
    const extra = [
      ...CASES,
      record('x', 'failed', null, null),
      { ...record('y', 'failed', 'failed', 'failed'), actRuleId: '59796f' },
    ];
    const r = analyse({ table: table(), cases: extra, implementedRules: ['23a2a8', '59796f'] });
    expect(r.scopes.find((s) => s.id === 'scan')?.cases).toBe(6);
  });

  it('reports agreement only over cases both engines answered', () => {
    const pair = report.agreement.find(
      (a) => a.engines[0] === 'marlo' && a.engines[1] === 'axe-core',
    );
    expect(pair?.cases).toBe(6);
    expect(pair?.percentAgreement).toBeCloseTo(4 / 6, 4);
  });

  it('holds no real-page figures until a cell is resolved, and scores them once one is', () => {
    expect(report.realPages).toBeNull();
    const rated = analyse({
      table: table(),
      cases: CASES,
      implementedRules: ['23a2a8'],
      realCells: [
        {
          page: 'shop-01',
          actRuleId: '23a2a8',
          truth: 'failed',
          actual: { 'axe-core': 'passed', marlo: 'failed' },
        },
        { page: 'shop-02', actRuleId: '23a2a8', truth: 'cantTell', actual: { marlo: 'failed' } },
        { page: 'shop-03', actRuleId: '23a2a8', truth: undefined, actual: { marlo: 'failed' } },
      ],
    });
    expect(rated.realPages?.resolvedCells).toBe(1);
    const routed = rated.realPages?.strategies.find((s) => s.id === 'routed-in-sample');
    // The published routing chose axe-core, which missed it.
    expect(routed?.falseNegatives).toBe(1);
    expect(rated.realPages?.strategies.some((s) => s.id === 'routed-held-out')).toBe(false);
  });

  it('counts the flattered entries at each threshold', () => {
    const flattered = analyse({
      table: table({
        entries: [
          { ...entry('marlo'), strict: { ...entry('marlo').strict, recall: 0.3 } },
          { ...entry('axe-core'), strict: { ...entry('axe-core').strict, recall: 0.6 } },
        ],
      }),
      cases: CASES,
      implementedRules: ['23a2a8'],
    }).flatterySensitivity;
    expect(flattered.map((f) => f.entries)).toEqual([0, 1, 2]);
    expect(flattered.map((f) => f.marloEntries)).toEqual([0, 1, 1]);
  });
});
