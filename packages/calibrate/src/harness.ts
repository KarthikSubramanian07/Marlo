import type {
  ActRuleId,
  CalibrationEntry,
  CalibrationTable,
  EngineId,
  Outcome,
  RoutingDecision,
} from '@marlo/schema';
import { FLATTERY_RECALL_THRESHOLD } from '@marlo/schema';
import {
  PUBLISHED_ACT_RULE_COUNT,
  UNMEASURABLE_ACT_RULES,
  aggregateStrictAccuracy,
  automationOf,
  consistencyOf,
  disallowedCount,
  isFlatteredByProtocol,
  meetsAutoFixThreshold,
  outcomeMatrixOf,
  strictAccuracyOf,
  type GradedCase,
} from '@marlo/act';
import type { Engine } from '@marlo/engines';
import { collapseOutcome } from '@marlo/engines';
import type { Renderer } from '@marlo/render';
import { IMPLEMENTED_RULES } from '@marlo/rules';
import type { Corpus, CorpusCase } from './corpus.js';

/**
 * The calibration harness.
 *
 * Runs every engine over every test case for every rule it claims, grades the results
 * two ways, and produces the table everything downstream reads from.
 *
 * The design constraint that matters: every engine goes through the same code path. No
 * engine gets a longer timeout, a retry, a different renderer, or a special case. Marlo's
 * own engine is one of the four and receives no exemption, which is DECISIONS.md D-008
 * and the reason the table is worth anything.
 */

export interface HarnessOptions {
  readonly corpus: Corpus;
  readonly renderer: Renderer;
  readonly engines: readonly Engine[];
  /** ACT rules to measure. Defaults to every rule any engine claims. */
  readonly rules?: readonly ActRuleId[];
  readonly autoFix: { readonly minStrictPrecision: number; readonly minSampleSize: number };
  /** The commit the harness ran at, or null from a dirty tree. */
  readonly commit: string | null;
  /** ISO date. Passed in rather than read from the clock, so a run is reproducible. */
  readonly generated: string;
  readonly onProgress?: (done: number, total: number, label: string) => void;
}

/** One engine's graded results for one rule. */
interface RuleMeasurement {
  readonly graded: GradedCase[];
  readonly engineRuleIds: Set<string>;
}

/**
 * The root element a test case document declares, or null if it declares none.
 *
 * Read from the source bytes rather than from the parsed DOM, which is the whole point:
 * the parser is what loses this information.
 */
export function declaredRootElement(html: string): string | null {
  const withoutPreamble = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\?[^?]*\?>/g, '');
  return /<\s*([a-zA-Z][\w:-]*)/.exec(withoutPreamble)?.[1]?.toLowerCase() ?? null;
}

/**
 * Can this renderer represent this document faithfully?
 *
 * FOUND BY THE FIRST HARNESS RUN, AND IT MATTERS.
 *
 * Every engine, including Marlo's, scored precision 0.67 on b5c3f8 and graded
 * `incorrect`. Four independent engines failing identically is a harness defect rather
 * than four coincidences, and it was: the rule's two inapplicable examples are
 * `<svg xmlns="...">` and `<math></math>`, documents whose root element is not `html`.
 *
 * `document.write` on an HTML Document always produces an `html` root, so both documents
 * arrive at the engines as an HTML page containing an svg or math element. Every engine
 * then correctly reports that the html element has no lang attribute. The finding is
 * right about the document it was given and the document is wrong.
 *
 * Grading those cases would put a false positive on all four engines' records for a
 * defect none of them has. So the harness reports them as `unsupported`, which is the
 * capability model applied one level up: a measurement the renderer could not take
 * honestly is reported as not taken, never as a result.
 *
 * The consequence is visible rather than hidden. Those cases appear in the `unsupported`
 * column of the outcome matrix, so a reader can see exactly how many test cases each
 * rule's measurement rests on, and coverage of non-HTML root documents is a real gap
 * recorded in HONESTY.md. A browser renderer represents them correctly, which is one
 * more reason the two renderers are diffed in CI.
 */
export function rendererCanRepresent(renderer: Renderer, html: string): boolean {
  if (renderer.id !== 'static') return true;
  const root = declaredRootElement(html);
  if (root === null) return true;
  // Only a foreign-namespace root is unrepresentable. An HTML fragment such as
  // `<img src="a.png">` is fine: a browser wraps it in html and body too, which is the
  // same document happy-dom produces.
  //
  // The first version of this check rejected anything whose root was not `html`, which
  // skipped 444 of 524 cases and made every number rest on a sixth of the corpus. That
  // is the kind of mistake that makes a measurement look conservative while actually
  // making it meaningless, so the fix is narrow and the reason is written down.
  return !FOREIGN_ROOTS.has(root);
}

/**
 * Root elements that make a document something other than an HTML document.
 *
 * An SVG or MathML document has its own root and its own namespace. Writing one into an
 * HTML Document produces an HTML page containing that element, which is a different
 * document with different accessibility semantics.
 */
const FOREIGN_ROOTS: ReadonlySet<string> = new Set(['svg', 'math']);

async function measureRule(
  engine: Engine,
  actRuleId: ActRuleId,
  cases: readonly CorpusCase[],
  options: HarnessOptions,
): Promise<RuleMeasurement> {
  const graded: GradedCase[] = [];
  const engineRuleIds = new Set<string>();

  for (const testCase of cases) {
    const html = options.corpus.read(testCase);

    if (!rendererCanRepresent(options.renderer, html)) {
      // Not graded. See rendererCanRepresent: grading a document the renderer
      // misrepresented would record a false positive against every engine for a defect
      // none of them has.
      graded.push({ expected: testCase.expected, actual: null, unsupported: true });
      continue;
    }

    const page = await options.renderer.render({
      html,
      // The corpus documents were authored to be served from the ACT site, and a few
      // rules read the document URL. Using the real one keeps the measurement faithful.
      url: `https://act-rules.github.io/${testCase.path}`,
    });

    try {
      const report = await engine.evaluate(page, [actRuleId]);
      const result = report.results.find((r) => r.actRuleId === actRuleId);

      if (result === undefined) {
        // An engine that omits a requested rule is a bug in that adapter, and it is
        // recorded as an error rather than quietly skipped.
        graded.push({ expected: testCase.expected, actual: null, errored: true });
        continue;
      }

      for (const verdict of result.verdicts) engineRuleIds.add(verdict.engineRuleId);

      switch (result.status) {
        case 'ok':
          graded.push({
            expected: testCase.expected,
            actual: collapseOutcome(result.verdicts),
          });
          break;
        case 'error':
          graded.push({ expected: testCase.expected, actual: null, errored: true });
          break;
        case 'unsupported':
          graded.push({ expected: testCase.expected, actual: null, unsupported: true });
          break;
      }
    } finally {
      await page.close();
    }
  }

  return { graded, engineRuleIds };
}

function entryFor(
  engine: Engine,
  actRuleId: ActRuleId,
  measurement: RuleMeasurement,
  testCaseCount: number,
): CalibrationEntry {
  const { graded, engineRuleIds } = measurement;
  const strict = strictAccuracyOf(graded);
  const consistency = consistencyOf(graded);
  const mappingEntries = engine.mapping.actToEngine(actRuleId);

  // A single `kind` for a rule several engine rules serve. `exact` only when every
  // contributing entry claims it, because a set containing a partial is a partial.
  const kinds = new Set(mappingEntries.map((e) => e.kind));
  const mappingKind: CalibrationEntry['mappingKind'] =
    mappingEntries.length === 0
      ? 'none'
      : kinds.has('superset')
        ? 'superset'
        : kinds.has('partial') || kinds.size > 1
          ? 'partial'
          : 'exact';

  const matrix = outcomeMatrixOf(graded);

  return {
    actRuleId,
    engine: engine.id,
    engineVersion: engine.version,
    engineRuleIds: [...engineRuleIds].sort(),
    mappingKind,
    testCaseCount,
    matrix: {
      passed: matrix.passed,
      failed: matrix.failed,
      inapplicable: matrix.inapplicable,
      errored: matrix.errored,
      unsupported: matrix.unsupported,
    },
    act: {
      consistency,
      automation: automationOf(graded),
      disallowed: disallowedCount(graded),
    },
    strict,
    // The column nobody publishes: the official protocol says consistent while the
    // number a user experiences is poor.
    flatteredByProtocol: isFlatteredByProtocol(
      consistency,
      strict.recall,
      FLATTERY_RECALL_THRESHOLD,
    ),
  };
}

/**
 * Chooses which engine reports a rule.
 *
 * Ordered on strict recall, then strict precision, then ACT consistency. Recall first
 * because a rule Marlo routes to an engine that misses half the violations is a rule
 * Marlo may as well not claim; precision then decides between engines that find the
 * same amount.
 *
 * `unmapped` and `incorrect` engines are never chosen. An `incorrect` engine has flagged
 * a passing example, which is a false positive, and preferring it because it happens to
 * have high recall would be preferring noise.
 */
export function routeRule(
  actRuleId: ActRuleId,
  entries: readonly CalibrationEntry[],
  autoFix: { readonly minStrictPrecision: number; readonly minSampleSize: number },
): RoutingDecision {
  const eligible = entries
    .filter((e) => e.actRuleId === actRuleId)
    .filter((e) => e.mappingKind !== 'none')
    .filter((e) => e.act.consistency !== 'unmapped');

  const candidates = [...eligible]
    .sort(
      (a, b) =>
        (b.strict.recall ?? -1) - (a.strict.recall ?? -1) ||
        (b.strict.precision ?? -1) - (a.strict.precision ?? -1),
    )
    .map((e) => ({
      engine: e.engine,
      strictRecall: e.strict.recall,
      strictPrecision: e.strict.precision,
      consistency: e.act.consistency,
    }));

  const usable = eligible.filter((e) => e.act.consistency !== 'incorrect');
  const best = [...usable].sort(
    (a, b) =>
      (b.strict.recall ?? -1) - (a.strict.recall ?? -1) ||
      (b.strict.precision ?? -1) - (a.strict.precision ?? -1),
  )[0];

  if (best === undefined) {
    return {
      actRuleId,
      chosen: null,
      reason: eligible.length === 0 ? 'no-implementer' : 'uncalibrated',
      candidates,
      autoFixPermitted: false,
    };
  }

  const measured = best.testCaseCount > 0 && best.strict.precision !== null;
  return {
    actRuleId,
    chosen: best.engine,
    reason: !measured ? 'uncalibrated' : usable.length === 1 ? 'sole-implementer' : 'best-measured',
    candidates,
    autoFixPermitted: meetsAutoFixThreshold(best.strict, autoFix),
  };
}

export async function runHarness(options: HarnessOptions): Promise<CalibrationTable> {
  const claimed = new Set<ActRuleId>();
  for (const engine of options.engines)
    for (const rule of engine.mapping.claimedRules) claimed.add(rule);
  const rules = [...(options.rules ?? [...claimed])].sort();

  const entries: CalibrationEntry[] = [];
  const total = rules.length * options.engines.length;
  let done = 0;

  for (const actRuleId of rules) {
    const cases = options.corpus.forRule(actRuleId);
    for (const engine of options.engines) {
      // Every engine, every rule, same path. An engine that does not claim the rule
      // still gets measured, and the result is `unmapped`, which is distinct from
      // `incorrect` and must stay so.
      const measurement = await measureRule(engine, actRuleId, cases, options);
      entries.push(entryFor(engine, actRuleId, measurement, cases.length));
      done += 1;
      options.onProgress?.(done, total, `${actRuleId} / ${engine.id}`);
    }
  }

  const routing = rules.map((actRuleId) => routeRule(actRuleId, entries, options.autoFix));

  // The headline figures rest on Marlo's own rules only, because that is what the
  // README's accuracy claim is about. A figure pooling every engine would be a
  // statement about the ensemble, which Marlo deliberately does not ship.
  const marloEntries = entries.filter(
    (e) => e.engine === 'marlo' && e.mappingKind !== 'none' && e.testCaseCount > 0,
  );
  const aggregate = aggregateStrictAccuracy(marloEntries.map((e) => e.strict));

  const implemented = [...IMPLEMENTED_RULES];
  const unmeasurable = implemented.filter((id) => UNMEASURABLE_ACT_RULES.includes(id));

  return {
    schemaVersion: 1,
    generated: options.generated,
    commit: options.commit,
    corpus: {
      retrieved: options.corpus.retrieved,
      rules: options.corpus.totals.rules,
      rulesWithTestCases: options.corpus.totals.rulesWithTestCases,
      testCases: options.corpus.totals.testCases,
    },
    engines: options.engines.map((engine) => ({
      id: engine.id,
      version: engine.version,
      mappedRules: engine.mapping.claimedRules.size,
    })),
    renderer: options.renderer.id === 'browser' ? 'browser' : 'static',
    entries,
    routing,
    autoFixThreshold: {
      minStrictPrecision: options.autoFix.minStrictPrecision,
      minSampleSize: options.autoFix.minSampleSize,
      rationale:
        'Precision rather than recall, because the two failures cost differently: a missed ' +
        'violation is a gap the developer already had, and a wrong fix is a change to their code ' +
        'they did not ask for. The sample floor exists because a precision of 1.0 over two ' +
        'examples is not evidence.',
    },
    coverage: {
      implemented: implemented.length,
      publishedActRules: PUBLISHED_ACT_RULE_COUNT,
      calibratable: implemented.length - unmeasurable.length,
      implementedButUnmeasurable: unmeasurable,
    },
    aggregate,
  };
}

/** Every distinct outcome an engine produced, for a quick sanity read. */
export function outcomeSpread(
  entries: readonly CalibrationEntry[],
  engine: EngineId,
): Record<Outcome, number> {
  const spread: Record<Outcome, number> = { passed: 0, failed: 0, cantTell: 0, inapplicable: 0 };
  for (const entry of entries) {
    if (entry.engine !== engine) continue;
    for (const row of [entry.matrix.passed, entry.matrix.failed, entry.matrix.inapplicable]) {
      for (const [outcome, count] of Object.entries(row)) {
        if (outcome in spread) spread[outcome as Outcome] += count;
      }
    }
  }
  return spread;
}
