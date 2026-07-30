import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  ActRuleId,
  CalibrationTable,
  EngineId,
  EngineReport,
  Outcome,
  RuleResult,
} from '@marlo/schema';
import { CalibrationTable as CalibrationTableSchema } from '@marlo/schema';

import { decideRule, invariantViolations } from './invariant.js';

/**
 * The one-directional invariant.
 *
 * IF ANY PEER ENGINE REPORTS A FAILURE FOR AN ACT RULE, MARLO MAY NOT REPORT CLEAN.
 *
 * Borrowed from the sibling PDF project, whose worst defect survived because two checkers
 * agreed with each other and both were wrong while veraPDF disagreed and was right.
 *
 * The last test in this file is exhaustive rather than by example, over every combination
 * of four engines and four outcomes: 256 cases. An invariant checked by three examples is
 * an anecdote, and this one is the single thing standing between Marlo and the failure mode
 * it exists to prevent.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const table: CalibrationTable = CalibrationTableSchema.parse(
  JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
);

const ALL_OUTCOMES: readonly Outcome[] = ['passed', 'failed', 'cantTell', 'inapplicable'];
const ENGINES: readonly EngineId[] = ['marlo', 'axe-core', 'alfa', 'htmlcs'];

/** A rule result for one engine with one collapsed outcome. */
function result(
  engine: EngineId,
  actRuleId: ActRuleId,
  outcome: Outcome | 'error' | 'unsupported',
): RuleResult {
  if (outcome === 'error') {
    return {
      actRuleId,
      engine,
      status: 'error',
      verdicts: [],
      error: 'boom',
      missingCapabilities: [],
      durationMs: 1,
    };
  }
  if (outcome === 'unsupported') {
    return {
      actRuleId,
      engine,
      status: 'unsupported',
      verdicts: [],
      error: null,
      missingCapabilities: ['layout'],
      durationMs: 0,
    };
  }
  return {
    actRuleId,
    engine,
    status: 'ok',
    verdicts:
      outcome === 'inapplicable'
        ? []
        : [
            {
              engine,
              engineVersion: '1.0.0',
              engineRuleId: `${engine}/rule`,
              actRuleId,
              outcome,
              target: { selector: 'html', snippet: '<html>', path: [] },
              message: `${engine} says ${outcome}`,
            },
          ],
    error: null,
    missingCapabilities: [],
    durationMs: 1,
  };
}

function report(engine: EngineId, results: readonly RuleResult[]): EngineReport {
  return {
    engine,
    engineVersion: '1.0.0',
    renderer: 'static',
    results: [...results],
    notRequested: [],
    durationMs: 1,
  };
}

/** A rule the committed table routes to a known engine, for realistic tests. */
function routedRule(): { actRuleId: ActRuleId; chosen: EngineId } {
  const decision = table.routing.find((r) => r.chosen !== null);
  const chosen = decision?.chosen;
  if (decision === undefined || chosen === null || chosen === undefined) {
    throw new Error('the committed table routes nothing');
  }
  return { actRuleId: decision.actRuleId, chosen };
}

describe('routing decides who speaks', () => {
  it('reports the routed engine verdict when nobody dissents', () => {
    const { actRuleId, chosen } = routedRule();
    const reports = ENGINES.map((engine) => report(engine, [result(engine, actRuleId, 'passed')]));
    const verdict = decideRule(actRuleId, reports, table);
    expect(verdict.outcome).toBe('passed');
    expect(verdict.reportedBy).toBe(chosen);
    expect(verdict.invariantEnforced).toBe(false);
  });

  it('records a disagreement without changing the outcome when nobody failed', () => {
    const { actRuleId, chosen } = routedRule();
    const reports = ENGINES.map((engine) =>
      report(engine, [result(engine, actRuleId, engine === chosen ? 'passed' : 'cantTell')]),
    );
    const verdict = decideRule(actRuleId, reports, table);
    expect(verdict.outcome).toBe('passed');
    expect(verdict.invariantEnforced).toBe(false);
    // Recorded rather than suppressed. Both directions of disagreement are information.
    expect(verdict.disagreements.length).toBeGreaterThan(0);
  });

  it('falls back to cantTell when the routed engine produced nothing', () => {
    const { actRuleId, chosen: routedEngine } = routedRule();
    const chosen = routedEngine;
    const reports = ENGINES.filter((e) => e !== chosen).map((engine) =>
      report(engine, [result(engine, actRuleId, 'inapplicable')]),
    );
    const verdict = decideRule(actRuleId, reports, table);
    // Never `passed`. Marlo did not hear from the engine it trusts for this rule, and
    // inventing a pass on that basis is the failure the whole design prevents.
    expect(verdict.outcome).toBe('cantTell');
  });

  it('treats a rule the table does not route as uncalibrated', () => {
    const unrouted = '2t702h';
    const reports = [report('marlo', [result('marlo', unrouted, 'passed')])];
    const verdict = decideRule(unrouted, reports, table);
    expect(verdict.routingReason).toBe('uncalibrated');
  });
});

describe('the invariant overrides routing', () => {
  it('reports failed when a peer failed and the routed engine passed', () => {
    const { actRuleId, chosen } = routedRule();
    const dissenter = ENGINES.find((e) => e !== chosen);
    expect(dissenter).toBeDefined();
    if (dissenter === undefined) return;

    const reports = ENGINES.map((engine) =>
      report(engine, [result(engine, actRuleId, engine === dissenter ? 'failed' : 'passed')]),
    );
    const verdict = decideRule(actRuleId, reports, table);

    expect(verdict.outcome).toBe('failed');
    expect(verdict.invariantEnforced).toBe(true);
    expect(verdict.routingReason).toBe('invariant');
    expect(verdict.reportedBy).toBe(dissenter);
  });

  it('overrides cantTell and inapplicable too, not only passed', () => {
    // Every non-failed outcome is "clean" for the purposes of the invariant. An
    // implementation that only guarded `passed` would let a peer's failure be buried
    // under a routed `inapplicable`, which is the more likely accident of the two.
    const { actRuleId, chosen } = routedRule();
    const dissenter = ENGINES.find((e) => e !== chosen);
    if (dissenter === undefined) return;

    for (const routedOutcome of ['passed', 'cantTell', 'inapplicable'] as const) {
      const reports = ENGINES.map((engine) =>
        report(engine, [
          result(engine, actRuleId, engine === dissenter ? 'failed' : routedOutcome),
        ]),
      );
      expect(decideRule(actRuleId, reports, table).outcome, routedOutcome).toBe('failed');
    }
  });

  it('carries the calibration evidence for preferring the routed engine', () => {
    // Marlo may dissent, and only explicitly and on the record. A reader has to be able to
    // see why the router preferred one engine over the one that disagreed.
    const { actRuleId, chosen } = routedRule();
    const dissenter = ENGINES.find((e) => e !== chosen);
    if (dissenter === undefined) return;

    const reports = ENGINES.map((engine) =>
      report(engine, [result(engine, actRuleId, engine === dissenter ? 'failed' : 'passed')]),
    );
    const verdict = decideRule(actRuleId, reports, table);
    const recorded = verdict.disagreements.find((d) => d.engine === dissenter);
    expect(recorded).toBeDefined();
    expect(recorded?.outcome).toBe('failed');
    expect(recorded).toHaveProperty('chosenEngineStrictRecall');
  });

  it('does not fire when the routed engine already failed', () => {
    const { actRuleId } = routedRule();
    const reports = ENGINES.map((engine) => report(engine, [result(engine, actRuleId, 'failed')]));
    const verdict = decideRule(actRuleId, reports, table);
    expect(verdict.outcome).toBe('failed');
    // Not an override: everyone agrees, so the routing reason stands.
    expect(verdict.invariantEnforced).toBe(false);
    expect(verdict.routingReason).not.toBe('invariant');
  });

  it('is not triggered by a crash or an unsupported rule', () => {
    // A peer that threw did not report a failure. Treating a crash as a dissenting
    // failure would make every flaky engine able to force Marlo's verdict.
    const { actRuleId, chosen } = routedRule();
    const dissenter = ENGINES.find((e) => e !== chosen);
    if (dissenter === undefined) return;

    for (const broken of ['error', 'unsupported'] as const) {
      const reports = ENGINES.map((engine) =>
        report(engine, [result(engine, actRuleId, engine === dissenter ? broken : 'passed')]),
      );
      const verdict = decideRule(actRuleId, reports, table);
      expect(verdict.outcome, broken).toBe('passed');
      expect(verdict.invariantEnforced, broken).toBe(false);
    }
  });
});

describe('the invariant holds exhaustively', () => {
  it('never reports clean when any engine failed, over all 256 combinations', () => {
    // Four engines, four outcomes each. Enumerated rather than sampled, because an
    // invariant checked by three examples is an anecdote and this is the one property the
    // project cannot afford to get wrong.
    const { actRuleId } = routedRule();
    let combinations = 0;
    let invariantFired = 0;

    for (const a of ALL_OUTCOMES) {
      for (const b of ALL_OUTCOMES) {
        for (const c of ALL_OUTCOMES) {
          for (const d of ALL_OUTCOMES) {
            const outcomes: readonly Outcome[] = [a, b, c, d];
            const reports = ENGINES.map((engine, i) =>
              report(engine, [result(engine, actRuleId, outcomes[i] ?? 'inapplicable')]),
            );
            const verdict = decideRule(actRuleId, reports, table);
            combinations += 1;

            const anyFailed = outcomes.includes('failed');
            if (anyFailed) {
              // The invariant, stated as an assertion.
              expect(
                verdict.outcome,
                `outcomes [${outcomes.join(', ')}] produced ${verdict.outcome}`,
              ).toBe('failed');
            }
            if (verdict.invariantEnforced) invariantFired += 1;

            expect(invariantViolations([verdict])).toEqual([]);
          }
        }
      }
    }

    expect(combinations).toBe(256);
    // The invariant must actually have been exercised, not merely never violated because
    // the routed engine happened to fail every time.
    expect(invariantFired).toBeGreaterThan(0);
  });

  it('invariantViolations finds a violation when one is constructed', () => {
    // The detector has to be able to detect. A checker that always returns empty is a
    // checker that proves nothing, which is the failure mode of the sibling project's
    // auditor.
    const { actRuleId } = routedRule();
    const fabricated = {
      actRuleId,
      outcome: 'passed' as const,
      reportedBy: 'marlo' as const,
      routingReason: 'best-measured' as const,
      agreedBy: [],
      disagreements: [],
      invariantEnforced: false,
      evidence: [result('axe-core', actRuleId, 'failed')],
    };
    const violations = invariantViolations([fabricated]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.dissentingEngine).toBe('axe-core');
  });

  it('finds nothing when every engine agrees the rule passes', () => {
    const { actRuleId } = routedRule();
    const reports = ENGINES.map((engine) => report(engine, [result(engine, actRuleId, 'passed')]));
    expect(invariantViolations([decideRule(actRuleId, reports, table)])).toEqual([]);
  });
});
