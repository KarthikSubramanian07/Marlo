import type {
  ActRuleId,
  EngineId,
  Outcome,
  RealCorpus,
  RealCorpusEntry,
  RealEngineAgreement,
  RoutingDecision,
} from '@trymarlo/schema';
import { aggregateStrictAccuracy, strictAccuracyOf, type GradedCase } from '@trymarlo/act';
import type { Adjudication, RealCorpusSource, RealPage, SheetCell } from './real-corpus.js';
import { cellKey } from './real-corpus.js';
import type { PageEvaluation } from './real-pool.js';
import { mapLimit } from './real-pool.js';

/**
 * The real-page measurement pass.
 *
 * Separate from `runHarness` and never pooled with it. The ACT pass grades against
 * expected outcomes the corpus ships with; this pass has no expected outcome until
 * two raters have rated a cell, so much of what it publishes needs no ground truth at
 * all: how often engines agree with each other, how often the one-directional invariant
 * would fire, and how many findings each engine reports per page.
 *
 * Grading uses resolved cells only. An unresolved cell is counted and never guessed at,
 * and a resolved `cantTell` is counted rather than scored.
 */

export interface RealHarnessOptions {
  readonly corpus: RealCorpusSource;
  readonly adjudication: Adjudication;
  /** Engines in table order, with the rules each claims. */
  readonly engines: readonly {
    readonly id: EngineId;
    readonly claimedRules: ReadonlySet<ActRuleId>;
  }[];
  /** Marlo's implemented rules: the rules a rater judges, and so the adjudication cells. */
  readonly implementedRules: readonly ActRuleId[];
  /** Routing from the ACT table, which is the routing Marlo ships. */
  readonly routing: readonly RoutingDecision[];
  readonly evaluate: (
    page: RealPage,
    engine: EngineId,
    rules: readonly ActRuleId[],
  ) => Promise<PageEvaluation>;
  /** Evaluations in flight at once. */
  readonly concurrency: number;
  readonly onProgress?: (done: number, total: number, label: string) => void;
}

export interface RealHarnessResult {
  readonly block: RealCorpus;
  /**
   * Every page by every rule Marlo implements, with each claiming engine's outcome and the
   * resolved answer where there is one. The block above keeps only totals; the analysis
   * scores routing on these cells once they are rated.
   */
  readonly cells: readonly {
    readonly page: string;
    readonly actRuleId: ActRuleId;
    readonly truth: Outcome | undefined;
    readonly actual: Readonly<Partial<Record<EngineId, Outcome | null>>>;
  }[];
  /** Every evaluation that did not finish, so the caller can say which. */
  readonly errors: readonly {
    readonly page: string;
    readonly engine: EngineId;
    readonly reason: string;
  }[];
}

/** Four decimals: enough to compare, few enough that the table stays readable. */
const round = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * Cohen's kappa and observed agreement for two raters over the same items.
 *
 * kappa = (po - pe) / (1 - pe), where po is the observed agreement and pe the agreement
 * expected by chance from each rater's own marginal frequencies. Null when there is
 * nothing to compare, and null when pe is 1, which happens only when both raters gave
 * one identical answer throughout: agreement is then total and kappa is undefined, and
 * printing 0 or 1 for it would be inventing a figure.
 */
export function cohensKappa(pairs: readonly (readonly [string, string])[]): {
  readonly percentAgreement: number | null;
  readonly kappa: number | null;
} {
  const n = pairs.length;
  if (n === 0) return { percentAgreement: null, kappa: null };
  const left = new Map<string, number>();
  const right = new Map<string, number>();
  let agree = 0;
  for (const [a, b] of pairs) {
    if (a === b) agree += 1;
    left.set(a, (left.get(a) ?? 0) + 1);
    right.set(b, (right.get(b) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [category, count] of left) pe += (count / n) * ((right.get(category) ?? 0) / n);
  // Compared with a tolerance: pe is a sum of products of fractions.
  if (Math.abs(1 - pe) < 1e-12) return { percentAgreement: po, kappa: null };
  return { percentAgreement: po, kappa: (po - pe) / (1 - pe) };
}

/** A pre-screened cell both raters left alone is a mechanical answer, not a rater's. */
const untouchedPrescreen = (cell: SheetCell): boolean =>
  cell.prescreened && cell.answer === 'inapplicable';

/** Summarises the adjudication record against the cells this corpus has. */
export function summariseAdjudication(
  adjudication: Adjudication,
  pages: readonly RealPage[],
  rules: readonly ActRuleId[],
): RealCorpus['adjudication'] {
  const a = new Map(adjudication.sheetA.map((c) => [cellKey(c.page, c.rule), c]));
  const b = new Map(adjudication.sheetB.map((c) => [cellKey(c.page, c.rule), c]));
  const rated: [Outcome, Outcome][] = [];
  let resolvedCells = 0;
  for (const page of pages) {
    for (const rule of rules) {
      const key = cellKey(page.id, rule);
      if (adjudication.resolved.has(key)) resolvedCells += 1;
      const left = a.get(key);
      const right = b.get(key);
      if (
        left === undefined ||
        right === undefined ||
        left.answer === null ||
        right.answer === null
      )
        continue;
      if (untouchedPrescreen(left) && untouchedPrescreen(right)) continue;
      rated.push([left.answer, right.answer]);
    }
  }
  const totalCells = pages.length * rules.length;
  const { percentAgreement, kappa } = cohensKappa(rated);
  return {
    status:
      resolvedCells === totalCells
        ? 'adjudicated'
        : resolvedCells === 0 && rated.length === 0
          ? 'awaiting-adjudication'
          : 'partial',
    ratedCells: rated.length,
    resolvedCells,
    totalCells,
    kappa: kappa === null ? null : round(kappa),
    percentAgreement: percentAgreement === null ? null : round(percentAgreement),
    // A sheet nobody has started names no rater, and is left out rather than guessed at.
    raters: adjudication.raters.flatMap((r) =>
      r.kind === null ? [] : [{ rater: r.rater, kind: r.kind, model: r.model }],
    ),
    resolutions: { ...adjudication.resolutions },
  };
}

export async function runRealHarness(options: RealHarnessOptions): Promise<RealHarnessResult> {
  const { corpus, engines } = options;
  const jobs = corpus.pages.flatMap((page) =>
    engines.map((engine) => ({ page, engine: engine.id, rules: [...engine.claimedRules].sort() })),
  );

  let done = 0;
  const evaluations = new Map<string, PageEvaluation>();
  const errors: { page: string; engine: EngineId; reason: string }[] = [];
  const settled = await mapLimit(jobs, options.concurrency, async (job) => {
    const evaluation = await options.evaluate(job.page, job.engine, job.rules);
    done += 1;
    options.onProgress?.(done, jobs.length, `${job.page.label} / ${job.engine}`);
    return { job, evaluation };
  });
  for (const { job, evaluation } of settled) {
    evaluations.set(`${job.page.id}/${job.engine}`, evaluation);
    if (evaluation.errored !== null) {
      errors.push({ page: job.page.label, engine: job.engine, reason: evaluation.errored });
    }
  }

  /** What one engine said about one rule on one page, or null when it gave no outcome. */
  const outcomeOf = (page: RealPage, engine: EngineId, rule: ActRuleId): Outcome | null => {
    const evaluation = evaluations.get(`${page.id}/${engine}`);
    return evaluation?.results.find((r) => r.actRuleId === rule)?.outcome ?? null;
  };

  const rules = [...new Set(engines.flatMap((e) => [...e.claimedRules]))].sort();
  const claimers = (rule: ActRuleId): EngineId[] =>
    engines.filter((e) => e.claimedRules.has(rule)).map((e) => e.id);

  const entries: RealCorpusEntry[] = [];
  for (const rule of rules) {
    for (const engine of claimers(rule)) {
      const outcomes = { passed: 0, failed: 0, cantTell: 0, inapplicable: 0 };
      let errored = 0;
      let unsupported = 0;
      let findings = 0;
      let resolvedCells = 0;
      let unresolvedCells = 0;
      let cantTellTruth = 0;
      const graded: GradedCase[] = [];

      for (const page of corpus.pages) {
        const evaluation = evaluations.get(`${page.id}/${engine}`);
        const result = evaluation?.results.find((r) => r.actRuleId === rule);
        if (
          result === undefined ||
          (evaluation?.errored ?? null) !== null ||
          result.status === 'error'
        ) {
          errored += 1;
        } else if (result.status === 'unsupported') {
          unsupported += 1;
        } else if (result.outcome !== null) {
          outcomes[result.outcome] += 1;
          findings += result.findings;
        }

        const truth = options.adjudication.resolved.get(cellKey(page.id, rule));
        if (truth === undefined) {
          unresolvedCells += 1;
          continue;
        }
        resolvedCells += 1;
        if (truth === 'cantTell') {
          cantTellTruth += 1;
          continue;
        }
        const actual = result?.status === 'ok' ? result.outcome : null;
        graded.push({ expected: truth, actual });
      }

      entries.push({
        actRuleId: rule,
        engine,
        outcomes,
        errored,
        unsupported,
        findings,
        graded: {
          resolvedCells,
          unresolvedCells,
          cantTellTruth,
          strict: graded.length === 0 ? null : strictAccuracyOf(graded),
        },
      });
    }
  }

  const agreement: RealEngineAgreement[] = [];
  for (const rule of rules) {
    const ids = claimers(rule);
    const enginePairs = ids.flatMap((left, i) =>
      ids.slice(i + 1).map((right) => [left, right] as const),
    );
    for (const [left, right] of enginePairs) {
      {
        const pairs: [Outcome, Outcome][] = [];
        for (const page of corpus.pages) {
          const a = outcomeOf(page, left, rule);
          const b = outcomeOf(page, right, rule);
          if (a !== null && b !== null) pairs.push([a, b]);
        }
        const { percentAgreement, kappa } = cohensKappa(pairs);
        agreement.push({
          actRuleId: rule,
          engines: [left, right],
          pages: pairs.length,
          percentAgreement: percentAgreement === null ? null : round(percentAgreement),
          kappa: kappa === null ? null : round(kappa),
        });
      }
    }
  }

  // A page counts as errored for an engine when the evaluation failed outright or the
  // engine reported an error on any rule. A rule that threw contributes no findings, so
  // summing the rest would print an undercount that reads as a cleaner page.
  const findingsOn = (page: RealPage, engine: EngineId): number | null => {
    const evaluation = evaluations.get(`${page.id}/${engine}`);
    if (evaluation?.errored !== null) return null;
    if (evaluation.results.some((r) => r.status === 'error')) return null;
    return evaluation.results.reduce((sum, r) => sum + r.findings, 0);
  };

  const findingsPerPage = engines.map(({ id }) => {
    const counts = corpus.pages.map((p) => findingsOn(p, id)).filter((n) => n !== null);
    const total = counts.reduce((sum, n) => sum + n, 0);
    return {
      engine: id,
      pages: counts.length,
      findings: total,
      mean: counts.length === 0 ? null : round(total / counts.length),
    };
  });

  const perPage = corpus.pages.map((page) => ({
    page: page.label,
    findings: Object.fromEntries(engines.map(({ id }) => [id, findingsOn(page, id)])),
  }));

  // The invariant, as decideRule in @trymarlo/report applies it: the routed engine's outcome
  // is the starting point, and any other engine reporting a failure overrides a routed
  // verdict that is not a failure. A routed engine that errored has no verdict, which
  // decideRule treats as cantTell, so a peer failure fires the invariant there too.
  const firingPages = new Set<string>();
  const perRule = [...options.routing]
    .filter((decision) => rules.includes(decision.actRuleId))
    .sort((x, y) => x.actRuleId.localeCompare(y.actRuleId))
    .map((decision) => {
      let fires = 0;
      for (const page of corpus.pages) {
        const routed =
          decision.chosen === null ? null : outcomeOf(page, decision.chosen, decision.actRuleId);
        const peerFailed = claimers(decision.actRuleId).some(
          (id) => id !== decision.chosen && outcomeOf(page, id, decision.actRuleId) === 'failed',
        );
        if (routed !== 'failed' && peerFailed) {
          fires += 1;
          firingPages.add(page.id);
        }
      }
      return {
        actRuleId: decision.actRuleId,
        routedTo: decision.chosen,
        pagesWhereItWouldFire: fires,
      };
    });

  const adjudication = summariseAdjudication(
    options.adjudication,
    corpus.pages,
    options.implementedRules,
  );

  // Marlo's own figure, from resolved cells only. Until something is resolved there is
  // nothing to pool and the figure is absent, which the schema enforces as well.
  const marloStrict = entries
    .filter((e) => e.engine === 'marlo')
    .map((e) => e.graded.strict)
    .filter((s) => s !== null);
  const accuracy =
    adjudication.resolvedCells === 0
      ? { strictPrecision: null, strictRecall: null, falsePositiveRate: null, sampleSize: 0 }
      : aggregateStrictAccuracy(marloStrict);

  // Every engine the same way, pooled over the rules it claims, so the engines can be
  // compared on the pages as they were compared on the ACT cases. Engines claim different
  // rules, so `rules` travels with each figure. Empty until something is resolved.
  const byEngine =
    adjudication.resolvedCells === 0
      ? []
      : [...new Set(entries.map((e) => e.engine))].sort().map((engine) => {
          const strict = entries
            .filter((e) => e.engine === engine)
            .map((e) => e.graded.strict)
            .filter((s) => s !== null);
          const sum = (pick: (s: (typeof strict)[number]) => number): number =>
            strict.reduce((total, s) => total + pick(s), 0);
          return {
            engine,
            rules: strict.length,
            truePositives: sum((s) => s.truePositives),
            falsePositives: sum((s) => s.falsePositives),
            falseNegatives: sum((s) => s.falseNegatives),
            trueNegatives: sum((s) => s.trueNegatives),
            ...aggregateStrictAccuracy(strict),
          };
        });

  const cells = corpus.pages.flatMap((page) =>
    options.implementedRules.map((rule) => {
      const actual: Partial<Record<EngineId, Outcome | null>> = {};
      for (const engine of claimers(rule)) actual[engine] = outcomeOf(page, engine, rule);
      return {
        page: page.id,
        actRuleId: rule,
        truth: options.adjudication.resolved.get(cellKey(page.id, rule)),
        actual,
      };
    }),
  );

  return {
    cells,
    errors,
    block: {
      retrieved: corpus.retrieved,
      pages: corpus.pages.length,
      categories: Object.entries(corpus.categories)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, pages]) => ({ category, pages })),
      adjudication,
      entries,
      agreement,
      aggregate: {
        findingsPerPage,
        perPage,
        invariant: {
          pages: corpus.pages.length,
          pagesWhereItWouldFire: firingPages.size,
          // The manifest refuses an empty corpus, so the denominator is never zero.
          fraction: round(firingPages.size / corpus.pages.length),
          perRule,
        },
        accuracy,
        engines: byEngine,
      },
    },
  };
}
