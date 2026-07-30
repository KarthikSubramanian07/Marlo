import type {
  ActRuleId,
  Capability,
  EngineId,
  EngineReport,
  Outcome,
  RuleResult,
} from '@marlo/schema';
import type { RenderedPage } from '@marlo/render';
import { checkCapabilities } from '@marlo/render';

/**
 * The engine adapter interface, and the mapping vocabulary that is the real work.
 *
 * RESEARCH.md §2 records the finding that shaped this package: no accessibility
 * engine ships a machine-readable mapping from its own rule identifiers to ACT rule
 * identifiers. It was checked rather than assumed. axe-core carries an `ACT` tag on
 * 85 of its 105 rules and no ACT rule ids anywhere. Alfa's 89 rules carry WCAG
 * criteria, WCAG techniques and European Accessibility Act references, and never an
 * ACT rule. HTML CodeSniffer carries WCAG technique codes only.
 *
 * So `mapping.ts` in each adapter directory is hand-written, every entry is a
 * judgment, and each judgment is checked against the official test cases by the
 * calibration harness. That labour is what makes the calibration table an asset
 * rather than a script, and it is the second-highest-value contribution surface
 * after new rules.
 */

/**
 * How faithfully an engine's rule corresponds to an ACT rule.
 *
 * This field is where the honesty lives, and getting it wrong is worse than not
 * having a mapping, because a `partial` labelled `exact` produces a confident
 * accuracy figure for a rule the engine only half implements.
 */
export type MappingKind =
  /**
   * The engine fires on the same condition the ACT rule describes. Every failing
   * example should be caught and no passing example flagged.
   */
  | 'exact'
  /**
   * The engine catches some of the rule's failing examples and not others, usually
   * because the ACT rule's applicability is broader. Verified by the harness: an
   * optimistic `exact` will be contradicted by the corpus.
   */
  | 'partial'
  /**
   * The engine also fires on things the ACT rule does not cover, so its findings for
   * this rule carry material not attributable to the rule. Precision measured
   * against this rule's test cases will understate the engine, and that is the
   * correct reading rather than a defect to correct.
   */
  | 'superset';

/**
 * One entry in an engine's ACT mapping.
 *
 * `note` is required. An entry without a stated reason is an assertion, and this
 * whole file exists because assertions about engine equivalence are what nobody has
 * published and what everybody assumes.
 */
export interface MappingEntry {
  /** The engine's own rule identifier, exactly as it reports it. */
  readonly engineRuleId: string;
  readonly actId: ActRuleId;
  readonly kind: MappingKind;
  /** Why this correspondence holds, and where it does not. */
  readonly note: string;
}

/** An engine's complete mapping, indexed both ways. */
export interface EngineMapping {
  readonly entries: readonly MappingEntry[];
  /** Engine rule ids that serve a given ACT rule. Several is normal. */
  actToEngine(actId: ActRuleId): readonly MappingEntry[];
  /** The ACT rules a given engine rule serves. Also several, occasionally. */
  engineToAct(engineRuleId: string): readonly MappingEntry[];
  /** Every ACT rule this engine claims. The engine's coverage. */
  readonly claimedRules: ReadonlySet<ActRuleId>;
}

/** Builds the indexed views once, at module load, from a flat list. */
export function buildMapping(entries: readonly MappingEntry[]): EngineMapping {
  const byAct = new Map<string, MappingEntry[]>();
  const byEngine = new Map<string, MappingEntry[]>();

  for (const entry of entries) {
    const act = byAct.get(entry.actId) ?? [];
    act.push(entry);
    byAct.set(entry.actId, act);

    const engine = byEngine.get(entry.engineRuleId) ?? [];
    engine.push(entry);
    byEngine.set(entry.engineRuleId, engine);
  }

  return {
    entries,
    actToEngine: (actId) => byAct.get(actId) ?? [],
    engineToAct: (engineRuleId) => byEngine.get(engineRuleId) ?? [],
    claimedRules: new Set(entries.map((e) => e.actId)),
  };
}

/**
 * What an adapter reports for one rule before the report is assembled.
 *
 * Deliberately not `RuleResult`: an adapter produces verdicts and a status, and the
 * timing and the ACT identifier are added by the harness so an adapter cannot
 * accidentally report a rule it was not asked about.
 */
export interface RawVerdict {
  readonly engineRuleId: string;
  readonly outcome: Outcome;
  readonly selector: string;
  readonly snippet: string;
  readonly message: string;
}

export interface Engine {
  readonly id: EngineId;
  /** Resolved from the dependency at load time, never hard-coded. */
  readonly version: string;
  /** What this engine needs from a renderer, at all. Per-rule needs are stricter. */
  readonly requires: readonly Capability[];
  readonly mapping: EngineMapping;
  /**
   * Evaluates the page and returns one result per requested rule.
   *
   * Every requested rule gets a result. A rule the engine does not implement comes
   * back as `unsupported` with no missing capabilities, which is distinct from a rule
   * it implements and found nothing for. Silence is not a pass.
   */
  evaluate(page: RenderedPage, actRuleIds: readonly ActRuleId[]): Promise<EngineReport>;
}

/**
 * Assembles an `EngineReport` from raw per-rule verdicts, applying the two rules no
 * adapter is allowed to get wrong.
 *
 * Every requested rule appears in the output, and a rule that was not evaluated is
 * marked as not evaluated rather than omitted. An omitted rule reads as a pass to
 * anything counting results, which is the failure the whole capability model exists
 * to prevent.
 */
export function assembleReport(options: {
  readonly engine: EngineId;
  readonly engineVersion: string;
  readonly page: RenderedPage;
  readonly requested: readonly ActRuleId[];
  readonly requires: readonly Capability[];
  readonly mapping: EngineMapping;
  /** Verdicts the engine produced, grouped by ACT rule. Absent means none. */
  readonly verdicts: ReadonlyMap<ActRuleId, readonly RawVerdict[]>;
  /** Rules the engine attempted and which threw, with the message. */
  readonly errors?: ReadonlyMap<ActRuleId, string>;
  readonly durationMs: number;
}): EngineReport {
  const capability = checkCapabilities(options.page, options.requires);
  const results: RuleResult[] = [];

  for (const actRuleId of options.requested) {
    const error = options.errors?.get(actRuleId);
    if (error !== undefined) {
      results.push({
        actRuleId,
        engine: options.engine,
        status: 'error',
        verdicts: [],
        error,
        missingCapabilities: [],
        durationMs: 0,
      });
      continue;
    }

    if (!capability.supported) {
      results.push({
        actRuleId,
        engine: options.engine,
        status: 'unsupported',
        verdicts: [],
        error: null,
        missingCapabilities: [...capability.missing],
        durationMs: 0,
      });
      continue;
    }

    // A rule the engine has no mapping for is unsupported, not clean. This is the
    // line that keeps an engine's silence out of the "no violations" column.
    if (!options.mapping.claimedRules.has(actRuleId)) {
      results.push({
        actRuleId,
        engine: options.engine,
        status: 'unsupported',
        verdicts: [],
        error: null,
        missingCapabilities: [],
        durationMs: 0,
      });
      continue;
    }

    const raw = options.verdicts.get(actRuleId) ?? [];
    results.push({
      actRuleId,
      engine: options.engine,
      status: 'ok',
      verdicts: raw.map((v) => ({
        engine: options.engine,
        engineVersion: options.engineVersion,
        engineRuleId: v.engineRuleId,
        actRuleId,
        outcome: v.outcome,
        target: { selector: v.selector, snippet: v.snippet, path: [] },
        message: v.message,
      })),
      error: null,
      missingCapabilities: [],
      durationMs: 0,
    });
  }

  return {
    engine: options.engine,
    engineVersion: options.engineVersion,
    renderer: options.page.renderer,
    results,
    notRequested: [...options.mapping.claimedRules].filter((r) => !options.requested.includes(r)),
    durationMs: options.durationMs,
  };
}

/**
 * Collapses several verdicts for one rule into the single outcome the ACT protocol
 * grades.
 *
 * The order is the point, and it is not the order that flatters an engine.
 *
 *   Any `failed`   ->  failed. One real violation is a violation, whatever else the
 *                      engine concluded about other elements.
 *   Any `cantTell` ->  cantTell. Uncertainty survives contact with certainty about
 *                      other elements. Promoting it to `passed` because some other
 *                      element passed is how a tool reports clean on a page it did
 *                      not understand.
 *   Any `passed`   ->  passed. The rule applied and found nothing wrong.
 *   Otherwise      ->  inapplicable. Nothing on the page was in scope.
 */
export function collapseOutcome(verdicts: readonly { readonly outcome: Outcome }[]): Outcome {
  if (verdicts.length === 0) return 'inapplicable';
  if (verdicts.some((v) => v.outcome === 'failed')) return 'failed';
  if (verdicts.some((v) => v.outcome === 'cantTell')) return 'cantTell';
  if (verdicts.some((v) => v.outcome === 'passed')) return 'passed';
  return 'inapplicable';
}

/** Truncates an evidence snippet. Evidence, not a document. */
export function truncateSnippet(html: string, limit = 240): string {
  const collapsed = html.replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}
