import type {
  ActRuleId,
  CalibrationTable,
  Disagreement,
  EngineId,
  EngineReport,
  Outcome,
  RuleResult,
} from '@marlo/schema';

/**
 * The one-directional invariant, and the routing it constrains.
 *
 * Borrowed from the sibling PDF project, whose auditor is cross-checked against veraPDF
 * with the rule that if the reference implementation rejects a document, the project's
 * own engine may not call it clean. Its worst defect survived because two checkers agreed
 * with each other and both were wrong, and veraPDF disagreed and was right.
 *
 * Marlo's version:
 *
 *   IF ANY PEER ENGINE REPORTS A FAILURE FOR AN ACT RULE, MARLO MAY NOT REPORT CLEAN
 *   FOR THAT RULE.
 *
 * It may dissent, and the dissent is recorded on the finding with the engine that
 * disagreed and the calibration evidence for preferring the router's verdict. What it may
 * not do is stay silent.
 *
 * Held at 100 percent coverage in CI. An uncovered branch here is a path where Marlo
 * reports clean while a peer engine reported a failure, which is the one outcome the whole
 * project is built to prevent.
 */

/** What routing and the invariant together concluded for one ACT rule. */
export interface RuleVerdict {
  readonly actRuleId: ActRuleId;
  /** The outcome Marlo reports. */
  readonly outcome: Outcome;
  /** Whose verdict this is. */
  readonly reportedBy: EngineId;
  readonly routingReason: 'best-measured' | 'sole-implementer' | 'uncalibrated' | 'invariant';
  /** Engines that agreed with the reported outcome. */
  readonly agreedBy: readonly EngineId[];
  readonly disagreements: readonly Disagreement[];
  /**
   * True when the invariant forced the outcome away from what the chosen engine said.
   * Surfaced in the terminal output and the pull request body, because it is the most
   * interesting thing that can happen in a run.
   */
  readonly invariantEnforced: boolean;
  /** The verdicts behind the reported outcome, for evidence. */
  readonly evidence: readonly RuleResult[];
}

/** Collapses a rule result to the single outcome the protocol grades. */
function collapse(result: RuleResult): Outcome | null {
  if (result.status !== 'ok') return null;
  if (result.verdicts.length === 0) return 'inapplicable';
  if (result.verdicts.some((v) => v.outcome === 'failed')) return 'failed';
  if (result.verdicts.some((v) => v.outcome === 'cantTell')) return 'cantTell';
  if (result.verdicts.some((v) => v.outcome === 'passed')) return 'passed';
  return 'inapplicable';
}

function strictRecallOf(
  table: CalibrationTable,
  actRuleId: ActRuleId,
  engine: EngineId,
): number | null {
  return (
    table.entries.find((e) => e.actRuleId === actRuleId && e.engine === engine)?.strict.recall ??
    null
  );
}

/**
 * Decides what Marlo reports for one ACT rule, given every engine's result.
 *
 * Two steps, in this order, and the order is the design:
 *
 * 1. Route. The calibration table names one engine per rule, and its verdict is the
 *    starting point. This is what keeps Marlo from unioning four engines' findings and
 *    calling the pile comprehensive, which is what Testaro did (D-003).
 *
 * 2. Apply the invariant. If any peer reported `failed` and the routed verdict is not
 *    `failed`, the reported outcome becomes `failed` anyway, the routing reason becomes
 *    `invariant`, and the dissent is recorded. Routing decides who speaks; it does not
 *    grant anyone the power to silence a peer.
 */
export function decideRule(
  actRuleId: ActRuleId,
  reports: readonly EngineReport[],
  table: CalibrationTable,
): RuleVerdict {
  const results = reports
    .map((report) => report.results.find((r) => r.actRuleId === actRuleId))
    .filter((r): r is RuleResult => r !== undefined);

  const routing = table.routing.find((r) => r.actRuleId === actRuleId);
  const chosen = routing?.chosen ?? null;

  const routed = results.find((r) => r.engine === chosen);
  const routedOutcome = routed === undefined ? null : collapse(routed);

  // Every engine that reported a failure, whether or not it was the routed one.
  const failing = results.filter((r) => collapse(r) === 'failed');

  const baseOutcome: Outcome = routedOutcome ?? 'cantTell';
  // `no-implementer` is not in this union because the schema forbids a `no-implementer`
  // routing from naming an engine, so by the time chosen is non-null the reason cannot be it.
  // That used to be a nested ternary here, guarding a table state that cannot exist. See the
  // refinement on RoutingDecision.
  const baseReason: RuleVerdict['routingReason'] =
    chosen === null || routing === undefined || routing.reason === 'no-implementer'
      ? 'uncalibrated'
      : routing.reason;

  // The invariant. A peer said failed and the routed verdict did not.
  //
  // The dissenting engine is read out here rather than at the point of use, because
  // `dissenting[0]` is `RuleResult | undefined` under noUncheckedIndexedAccess and inlining
  // it forced a second fallback that no input can reach. An unreachable fallback is a branch
  // no test can cover, which is how a file held at 100 percent stops being at 100 percent for
  // a reason that has nothing to do with the logic.
  const dissenting = failing.filter((r) => r.engine !== chosen);
  const firstDissenter: EngineId | null = dissenting[0]?.engine ?? null;
  const mustNotReportClean = firstDissenter !== null && baseOutcome !== 'failed';

  const disagreements: Disagreement[] = [];
  for (const result of results) {
    const outcome = collapse(result);
    if (outcome === null) continue;
    if (result.engine === chosen) continue;
    if (outcome === baseOutcome) continue;
    const verdict = result.verdicts[0];
    disagreements.push({
      engine: result.engine,
      engineRuleId: verdict?.engineRuleId ?? result.engine,
      outcome,
      message: verdict?.message ?? '',
      chosenEngineStrictRecall: chosen === null ? null : strictRecallOf(table, actRuleId, chosen),
    });
  }

  const outcome: Outcome = mustNotReportClean ? 'failed' : baseOutcome;
  // `mustNotReportClean` is defined as `firstDissenter !== null && ...`, so the checker has
  // already narrowed firstDissenter here and a second guard would be dead. Reading the
  // dissenter into a variable above is what makes that narrowing possible: inlining
  // `dissenting[0]?.engine` needed a fallback for an index the logic had already established
  // exists, and that fallback was a branch no input could reach.
  const reportedBy: EngineId = mustNotReportClean ? firstDissenter : (chosen ?? 'marlo');

  const agreedBy = results
    .filter((r) => collapse(r) === outcome)
    .map((r) => r.engine)
    .filter((e) => e !== reportedBy);

  return {
    actRuleId,
    outcome,
    reportedBy,
    routingReason: mustNotReportClean ? 'invariant' : baseReason,
    agreedBy,
    disagreements,
    invariantEnforced: mustNotReportClean,
    evidence: results,
  };
}

/**
 * Checks the invariant holds over a decided set. Used by property tests.
 *
 * Returns the rules where Marlo reported something other than `failed` while a peer
 * reported `failed`. An empty array is the only acceptable result.
 */
export function invariantViolations(
  verdicts: readonly RuleVerdict[],
): readonly { readonly actRuleId: ActRuleId; readonly dissentingEngine: EngineId }[] {
  const violations: { actRuleId: ActRuleId; dissentingEngine: EngineId }[] = [];

  for (const verdict of verdicts) {
    if (verdict.outcome === 'failed') continue;
    for (const result of verdict.evidence) {
      if (collapse(result) === 'failed') {
        violations.push({ actRuleId: verdict.actRuleId, dissentingEngine: result.engine });
      }
    }
  }
  return violations;
}
