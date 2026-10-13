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
 * Where a verdict points, as plain strings.
 *
 * The half of a verdict that cannot be recovered once a page has been left behind. On
 * the window path an adapter could read it off a live node at any time; on the browser
 * path the node never leaves the page, so the selector and the snippet are read off it
 * inside the page and only these two strings cross. Every in-page record carries exactly
 * this, under these names, and `narrowCarriedTarget` is the one place that reads it back.
 */
export interface CarriedTarget {
  /** A CSS selector, `xpath ` followed by a path for Alfa, or `:root` for the document. */
  readonly selector: string;
  /** The element's markup, or text for a text target. Trimmed by `truncateSnippet` later. */
  readonly snippet: string;
}

/**
 * What an adapter reports for one rule before the report is assembled.
 *
 * Deliberately not `RuleResult`: an adapter produces verdicts and a status, and the
 * timing and the ACT identifier are added by the harness so an adapter cannot
 * accidentally report a rule it was not asked about.
 *
 * This is also the shape every in-page payload reduces to. An engine run inside a
 * browser page hands back plain data, and whatever it hands back has to carry enough to
 * fill these five fields without a second trip, which is why the target half is its own
 * type. A verdict that arrives without it is a finding a developer cannot act on.
 */
export interface RawVerdict extends CarriedTarget {
  readonly engineRuleId: string;
  readonly outcome: Outcome;
  readonly message: string;
}

/**
 * Reads the target half of a record that came back across the page boundary.
 *
 * A missing or empty selector becomes `:root` rather than an empty string, because an
 * empty selector renders as a finding with no location at all, and `:root` is at least
 * what a document-level verdict truly points at. A missing snippet is an empty one.
 */
export function narrowCarriedTarget(item: object): CarriedTarget {
  const selector: unknown = Reflect.get(item, 'selector');
  const snippet: unknown = Reflect.get(item, 'snippet');
  return {
    selector: typeof selector === 'string' && selector !== '' ? selector : ':root',
    snippet: typeof snippet === 'string' ? snippet : '',
  };
}

/**
 * THE SERIALISATION BOUNDARY, DECIDED ONCE.
 *
 * Everything that crosses `page.evaluate` out of a browser page is structured-cloned,
 * so it has to be plain data: strings, numbers, booleans, arrays and objects of those.
 * No node, no function, no engine object. Each adapter's in-page code therefore returns
 * one of these envelopes, and exactly one function, `unwrapInPageResult`, opens it.
 *
 * The envelope exists so a failure inside the page arrives as data rather than as a
 * Playwright exception with the page's stack flattened into one line. The adapter's own
 * catch then records the message per rule, exactly as it does for a failure on the
 * window path, and `error` is never a pass anywhere downstream.
 *
 * The payload under `value` is plain, and every record in it that points at an element
 * carries a `CarriedTarget`: axe's result nodes (whose `target` and `html` axe itself
 * computes in the page, joined into a selector in Node), HTML CodeSniffer messages and
 * Alfa outcomes as records extending `CarriedTarget`, and Marlo's finished report, whose
 * verdict targets already have this shape. Translating a payload into `RawVerdict`s
 * happens in Node, in the same function the window path uses, so the two renderers
 * cannot disagree about what an engine said.
 */
export interface InPageSuccess {
  readonly ok: true;
  readonly value: unknown;
}

export interface InPageFailure {
  readonly ok: false;
  readonly error: string;
}

export type InPageResult = InPageSuccess | InPageFailure;

/**
 * Wraps a function body for `page.evaluate` so it always yields an `InPageResult`.
 *
 * `body` is the body of an async function and may `return` a value or `await` a
 * promise. The wrapper is an expression rather than a function, because Playwright
 * evaluates a string as an expression and awaits the promise it produces.
 */
export function inPageExpression(body: string): string {
  return (
    '(async () => {\n' +
    '  try {\n' +
    `    const value = await (async () => {\n${body}\n    })();\n` +
    '    return { ok: true, value };\n' +
    '  } catch (error) {\n' +
    '    const message = error !== null && typeof error === "object" && "message" in error\n' +
    '      ? String(error.message)\n' +
    '      : String(error);\n' +
    '    return { ok: false, error: message };\n' +
    '  }\n' +
    '})()'
  );
}

/**
 * Opens an envelope that came back across the boundary.
 *
 * Returns the payload, throws what the page threw, and refuses anything that is not an
 * envelope at all. The last case matters: a bundle built from an older revision, or a
 * page script that returned its payload bare, would otherwise be read as a payload with
 * every field missing, which an adapter would faithfully turn into findings at `:root`.
 */
export function unwrapInPageResult(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || typeof Reflect.get(raw, 'ok') !== 'boolean') {
    throw new TypeError(
      'the page returned something other than an in-page result envelope, so nothing it ' +
        'said can be trusted',
    );
  }
  if (Reflect.get(raw, 'ok') === true) return Reflect.get(raw, 'value');
  const error: unknown = Reflect.get(raw, 'error');
  throw new Error(
    `inside the page: ${typeof error === 'string' && error !== '' ? error : 'a failure with no message'}`,
  );
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
