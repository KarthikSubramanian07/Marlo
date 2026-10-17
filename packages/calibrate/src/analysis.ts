import type {
  ActRuleId,
  AnalysisReport,
  AnalysisScope,
  CalibrationEntry,
  CalibrationTable,
  EngineId,
  ExpectedOutcome,
  Outcome,
  Proportion,
  StrategyScore,
} from '@trymarlo/schema';
import { AnalysisReport as AnalysisReportSchema } from '@trymarlo/schema';
import { consistencyOf, strictAccuracyOf, type GradedCase } from '@trymarlo/act';
import { routeRule } from './harness.js';
import { cohensKappa } from './real-harness.js';

/**
 * The analysis the calibration table cannot hold, computed case by case.
 *
 * WHY THIS EXISTS
 *
 * The table's routing is chosen from the same per-rule grades the table publishes, and the
 * router refuses any engine that flagged a passing example. Scoring "the engine the router
 * picked" on those same cases is therefore an in-sample figure, and it came out at a
 * precision of 1.000, which is partly true by construction. The honest figures need the
 * router to be scored on cases it did not see, and they need what `marlo scan` actually
 * reports to be measured as a whole, rather than inferred from one of its parts.
 *
 * WHAT IT COMPUTES
 *
 *   Single engines, each answering the rules it claims and reporting nothing elsewhere.
 *   The routed engine, chosen from all cases: the in-sample figure, kept for comparison.
 *   The routed engine, chosen leave one out: for each case, the routing is recomputed from
 *     every other case of that rule with the same `routeRule` the table uses, and the case
 *     is decided by the engine chosen without it.
 *   What `marlo scan` reports: a rule fails when any engine fails it, because the
 *     one-directional invariant forbids reporting clean once a peer has failed. At the level
 *     of a test case's outcome that is the union of the engines' failures, so it is computed
 *     as the union and the equivalence is stated rather than hidden.
 *   A majority of engines failing, as the obvious alternative ensemble.
 *
 * Every proportion carries a Wilson score interval at 95 percent, because most rules have
 * fewer than thirty cases and a point estimate on its own overstates what is known.
 *
 * A case no engine could answer at all (every engine unsupported or errored, as with the
 * foreign-root documents the static renderer cannot represent) is left out of every scope,
 * so no strategy is credited or charged for a case nobody measured.
 */

const ENGINES: readonly EngineId[] = ['marlo', 'axe-core', 'alfa', 'htmlcs'];

/** Every engine's outcome on one official test case. Null is unsupported or errored. */
export interface CaseRecord {
  readonly actRuleId: ActRuleId;
  readonly path: string;
  readonly expected: ExpectedOutcome;
  readonly actual: Readonly<Partial<Record<EngineId, Outcome | null>>>;
}

/** Folds the harness's per-engine observations into one record per test case. */
export function collectCases(
  observations: readonly {
    readonly actRuleId: ActRuleId;
    readonly engine: EngineId;
    readonly path: string;
    readonly expected: ExpectedOutcome;
    readonly actual: Outcome | null;
  }[],
): CaseRecord[] {
  const byKey = new Map<
    string,
    { record: CaseRecord; actual: Partial<Record<EngineId, Outcome | null>> }
  >();
  for (const o of observations) {
    const key = `${o.actRuleId}|${o.path}`;
    let slot = byKey.get(key);
    if (slot === undefined) {
      const actual: Partial<Record<EngineId, Outcome | null>> = {};
      slot = {
        record: { actRuleId: o.actRuleId, path: o.path, expected: o.expected, actual },
        actual,
      };
      byKey.set(key, slot);
    }
    slot.actual[o.engine] = o.actual;
  }
  return [...byKey.values()].map((s) => s.record);
}

/** The Wilson score interval at 95 percent, rounded to four decimals, or null with no trials. */
export function wilson(successes: number, trials: number): Proportion | null {
  if (trials === 0) return null;
  const z = 1.959963984540054;
  const p = successes / trials;
  const z2 = z * z;
  const centre = (p + z2 / (2 * trials)) / (1 + z2 / trials);
  const half =
    (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / (1 + z2 / trials);
  const round = (x: number): number => Math.round(x * 10_000) / 10_000;
  return {
    value: round(p),
    low: Math.max(0, Math.min(round(p), round(centre - half))),
    high: Math.min(1, Math.max(round(p), round(centre + half))),
    successes,
    trials,
  };
}

/** The outcome a strategy gives a case. Null means it reports nothing, read as no detection. */
type Decide = (record: CaseRecord) => Outcome | null;

function score(
  id: string,
  label: string,
  description: string,
  records: readonly CaseRecord[],
  decide: Decide,
): StrategyScore {
  const graded: GradedCase[] = records.map((r) => ({
    expected: r.expected,
    actual: decide(r) ?? 'inapplicable',
  }));
  const s = strictAccuracyOf(graded);
  return {
    id,
    label,
    description,
    truePositives: s.truePositives,
    falsePositives: s.falsePositives,
    falseNegatives: s.falseNegatives,
    trueNegatives: s.trueNegatives,
    precision: wilson(s.truePositives, s.truePositives + s.falsePositives),
    recall: wilson(s.truePositives, s.truePositives + s.falseNegatives),
    falsePositiveRate: wilson(s.falsePositives, s.falsePositives + s.trueNegatives),
  };
}

/** The engines that claim a rule in the table, in table order. */
function claimersOf(table: CalibrationTable, actRuleId: ActRuleId): EngineId[] {
  return ENGINES.filter((engine) =>
    table.entries.some(
      (e) => e.actRuleId === actRuleId && e.engine === engine && e.mappingKind !== 'none',
    ),
  );
}

/**
 * The engine `routeRule` chooses for a rule from a set of cases, with each claiming engine
 * graded only on those cases. The same function the table uses, so the held-out routing
 * differs from the published one only in what it was allowed to see.
 */
export function routeFrom(
  table: CalibrationTable,
  actRuleId: ActRuleId,
  cases: readonly CaseRecord[],
): EngineId | null {
  // The published entries of the engines that claim the rule, regraded on these cases only.
  // Starting from the published entry keeps every field routeRule does not read as it was.
  const entries = table.entries
    .filter((e) => e.actRuleId === actRuleId && e.mappingKind !== 'none')
    .map((published): CalibrationEntry => {
      const graded: GradedCase[] = cases.map((c) => ({
        expected: c.expected,
        actual: c.actual[published.engine] ?? null,
      }));
      return {
        ...published,
        testCaseCount: cases.length,
        act: { ...published.act, consistency: consistencyOf(graded) },
        strict: strictAccuracyOf(graded),
      };
    });
  return routeRule(actRuleId, entries, table.autoFixThreshold).chosen;
}

/** True when any engine claiming the rule failed the case: what `marlo scan` reports. */
function anyFailed(table: CalibrationTable, record: CaseRecord): boolean {
  return claimersOf(table, record.actRuleId).some((e) => record.actual[e] === 'failed');
}

function strategiesFor(
  table: CalibrationTable,
  records: readonly CaseRecord[],
  heldOutChoice: ReadonlyMap<CaseRecord, EngineId | null>,
): StrategyScore[] {
  const routing = new Map(table.routing.map((r) => [r.actRuleId, r.chosen]));
  const claims = (engine: EngineId, rule: ActRuleId): boolean =>
    claimersOf(table, rule).includes(engine);
  const LABEL: Record<EngineId, string> = {
    marlo: 'Marlo',
    'axe-core': 'axe-core',
    alfa: 'Alfa',
    htmlcs: 'HTML CodeSniffer',
  };

  const out: StrategyScore[] = [
    score(
      'scan-output',
      'What marlo scan reports',
      'A rule fails on a page when any engine claiming it fails it, because the one-directional ' +
        'invariant forbids reporting clean once a peer has failed. At the level of a test ' +
        "case's outcome this is the union of the engines' failures.",
      records,
      (r) => (anyFailed(table, r) ? 'failed' : 'passed'),
    ),
  ];
  out.push(
    score(
      'routed-held-out',
      'Routed engine, leave one out',
      'For each case, the routing is recomputed from every other case of the rule with the ' +
        "table's own routeRule, and the case is decided by the engine chosen without it.",
      records,
      (r) => {
        const engine = heldOutChoice.get(r) ?? null;
        return engine === null ? null : (r.actual[engine] ?? null);
      },
    ),
    score(
      'routed-in-sample',
      'Routed engine, in sample',
      'The published routing, chosen from every case including the one being scored. ' +
        'Optimistic by construction, and kept only for comparison.',
      records,
      (r) => {
        const engine = routing.get(r.actRuleId) ?? null;
        return engine === null ? null : (r.actual[engine] ?? null);
      },
    ),
    score(
      'majority',
      'Majority of engines',
      'A rule fails when at least two of the engines claiming it fail it.',
      records,
      (r) =>
        claimersOf(table, r.actRuleId).filter((e) => r.actual[e] === 'failed').length >= 2
          ? 'failed'
          : 'passed',
    ),
  );
  for (const engine of ENGINES) {
    out.push(
      score(
        `single-${engine}`,
        `${LABEL[engine]} alone`,
        `${LABEL[engine]} on the rules it claims, reporting nothing on the rules it does not. ` +
          'A rule it could not evaluate on a case also counts as no detection, which is why this ' +
          "can differ from the table's per-rule figures, which leave such cases out.",
        records,
        (r) => (claims(engine, r.actRuleId) ? (r.actual[engine] ?? null) : null),
      ),
    );
  }
  return out;
}

export interface RealPageCell {
  readonly page: string;
  readonly actRuleId: ActRuleId;
  /** The resolved answer, or undefined when nobody has resolved the cell. */
  readonly truth: ExpectedOutcome | 'cantTell' | undefined;
  readonly actual: Readonly<Partial<Record<EngineId, Outcome | null>>>;
}

export function analyse(options: {
  readonly table: CalibrationTable;
  readonly cases: readonly CaseRecord[];
  readonly implementedRules: readonly ActRuleId[];
  readonly realCells?: readonly RealPageCell[];
}): AnalysisReport {
  const { table } = options;
  const routed = new Set(table.routing.filter((r) => r.chosen !== null).map((r) => r.actRuleId));
  const answered = options.cases.filter(
    (c) => routed.has(c.actRuleId) && Object.values(c.actual).some((a) => a !== null),
  );

  // Leave one out, once per case, shared by both scopes.
  const byRule = new Map<ActRuleId, CaseRecord[]>();
  for (const c of answered) {
    const list = byRule.get(c.actRuleId) ?? [];
    list.push(c);
    byRule.set(c.actRuleId, list);
  }
  const heldOut = new Map<CaseRecord, EngineId | null>();
  const changedRules = new Set<ActRuleId>();
  let changed = 0;
  for (const [rule, list] of byRule) {
    const published = table.routing.find((r) => r.actRuleId === rule)?.chosen ?? null;
    for (const c of list) {
      const choice = routeFrom(
        table,
        rule,
        list.filter((other) => other !== c),
      );
      heldOut.set(c, choice);
      if (choice !== published) {
        changed += 1;
        changedRules.add(rule);
      }
    }
  }

  const implemented = new Set(options.implementedRules);
  const scanCases = answered.filter((c) => implemented.has(c.actRuleId));
  const rulesIn = (list: readonly CaseRecord[]): number =>
    new Set(list.map((c) => c.actRuleId)).size;
  const scopes: AnalysisScope[] = [
    {
      id: 'scan',
      description:
        'The rules marlo scan evaluates, which are the rules Marlo implements: the set the ' +
        'product reports on, so the set its error rate has to be measured over.',
      rules: rulesIn(scanCases),
      cases: scanCases.length,
      strategies: strategiesFor(table, scanCases, heldOut),
    },
    {
      id: 'claimed',
      description:
        'Every rule any engine claims and the router assigns, for comparing strategies over ' +
        'the widest set all four engines are measured on.',
      rules: rulesIn(answered),
      cases: answered.length,
      strategies: strategiesFor(table, answered, heldOut),
    },
  ];

  // Agreement between engines on the cases both answered.
  const agreement: AnalysisReport['agreement'] = [];
  for (const [i, left] of ENGINES.entries()) {
    for (const right of ENGINES.slice(i + 1)) {
      const pairs: [Outcome, Outcome][] = [];
      for (const c of options.cases) {
        const claimers = claimersOf(table, c.actRuleId);
        if (!claimers.includes(left) || !claimers.includes(right)) continue;
        const a = c.actual[left] ?? null;
        const b = c.actual[right] ?? null;
        if (a !== null && b !== null) pairs.push([a, b]);
      }
      const all = cohensKappa(pairs);
      const failed = cohensKappa(
        pairs.map(([a, b]) => [
          a === 'failed' ? 'failed' : 'not',
          b === 'failed' ? 'failed' : 'not',
        ]),
      );
      const round = (x: number | null): number | null =>
        x === null ? null : Math.round(x * 10_000) / 10_000;
      agreement.push({
        engines: [left, right],
        cases: pairs.length,
        percentAgreement: round(all.percentAgreement),
        kappa: round(all.kappa),
        kappaFailed: round(failed.kappa),
      });
    }
  }

  const flatterySensitivity = [0.25, 0.5, 0.75].map((threshold) => {
    const flattered = table.entries.filter(
      (e) =>
        e.act.consistency === 'consistent' &&
        e.strict.recall !== null &&
        e.strict.recall < threshold,
    );
    return {
      recallBelow: threshold,
      entries: flattered.length,
      marloEntries: flattered.filter((e) => e.engine === 'marlo').length,
    };
  });

  // The other held-out design: routing from the official corpus, scored on rated real pages.
  const graded = (options.realCells ?? []).filter(
    (c): c is RealPageCell & { truth: ExpectedOutcome } =>
      c.truth !== undefined && c.truth !== 'cantTell' && routed.has(c.actRuleId),
  );
  const realPages =
    graded.length === 0
      ? null
      : {
          resolvedCells: graded.length,
          strategies: strategiesFor(
            table,
            graded.map((c) => ({
              actRuleId: c.actRuleId,
              path: c.page,
              expected: c.truth,
              actual: c.actual,
            })),
            // The router saw none of these pages, so the held-out choice is the published one.
            new Map(),
          ).filter((s) => s.id !== 'routed-held-out'),
        };

  return AnalysisReportSchema.parse({
    schemaVersion: 1,
    generated: table.generated,
    commit: table.commit,
    renderer: table.renderer,
    interval: 'wilson-95',
    scopes,
    routingStability: {
      cases: answered.length,
      casesWhereChoiceChanges: changed,
      rulesWhereChoiceChanges: [...changedRules].sort(),
    },
    agreement,
    realPages,
    flatterySensitivity,
  });
}
