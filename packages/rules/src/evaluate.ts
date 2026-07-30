import type {
  ActRuleId,
  Capability,
  EngineReport,
  Outcome,
  RendererId,
  RuleResult,
} from '@marlo/schema';
import type { MarloDocument, MarloElement } from './dom.js';
import { findMarloRule } from './registry.js';

/**
 * Runs Marlo's own rules and produces an `EngineReport`, the same shape a peer adapter
 * produces.
 *
 * It does not import @marlo/engines, and it cannot: a dependency rule forbids it, per
 * DECISIONS.md D-008. The sibling PDF project's worst defect survived because its
 * auditor searched for the same wrong URI its writer emitted, so it confirmed its own
 * bug and reported success. Marlo's engine is graded in the same table as its peers and
 * must not be able to observe them while deciding.
 *
 * The consequence is a small duplication: this file assembles a report and so does
 * @marlo/engines. That duplication is the enforcement mechanism, and it is cheaper than
 * the alternative.
 */

export interface EvaluateOptions {
  readonly document: MarloDocument;
  readonly renderer: RendererId;
  /** What the active renderer provides. Rules needing more report `unsupported`. */
  readonly capabilities: ReadonlySet<Capability>;
  readonly version: string;
}

/** One rule's verdict on one element, before collapsing. */
export interface MarloVerdictDetail {
  readonly element: MarloElement;
  readonly outcome: Outcome;
  readonly message: string;
}

function describeSelector(element: MarloElement): string {
  const id = element.attributes.find((a) => a.name === 'id')?.value;
  if (id !== undefined && id !== '') return `${element.tag}#${id}`;
  const className = element.attributes.find((a) => a.name === 'class')?.value;
  if (className !== undefined && className.trim() !== '') {
    return `${element.tag}.${className.trim().split(/\s+/)[0] ?? ''}`;
  }
  return element.tag;
}

function snippet(element: MarloElement): string {
  const html = element.outerHTML.replace(/\s+/g, ' ').trim();
  return html.length <= 240 ? html : `${html.slice(0, 239)}…`;
}

/**
 * Evaluates the requested rules.
 *
 * Every requested rule gets a result, and the three ways a rule can fail to produce a
 * verdict are kept distinct:
 *
 *   unsupported with capabilities  the renderer cannot support the rule
 *   unsupported with none          Marlo does not implement the rule
 *   error                          the rule threw
 *
 * None of the three is a pass. A rule that throws is caught per rule rather than per
 * run, because Marlo's rules are independent functions and one bad rule should not
 * discard the other thirty-four.
 */
export function evaluateRules(
  actRuleIds: readonly ActRuleId[],
  options: EvaluateOptions,
): EngineReport {
  const started = Date.now();
  const results: RuleResult[] = [];

  for (const actRuleId of actRuleIds) {
    const ruleStarted = Date.now();
    const rule = findMarloRule(actRuleId);

    if (rule === undefined) {
      results.push({
        actRuleId,
        engine: 'marlo',
        status: 'unsupported',
        verdicts: [],
        error: null,
        missingCapabilities: [],
        durationMs: 0,
      });
      continue;
    }

    const missing = rule.requires.filter((c) => !options.capabilities.has(c));
    if (missing.length > 0) {
      results.push({
        actRuleId,
        engine: 'marlo',
        status: 'unsupported',
        verdicts: [],
        error: null,
        missingCapabilities: missing,
        durationMs: 0,
      });
      continue;
    }

    try {
      const targets = rule.applicability(options.document);
      const verdicts = targets.map((target) => {
        const verdict = rule.expectation(target, options.document);
        return {
          engine: 'marlo' as const,
          engineVersion: options.version,
          engineRuleId: `marlo/${rule.actId}`,
          actRuleId,
          outcome: verdict.outcome,
          target: {
            selector: describeSelector(target.element),
            snippet: snippet(target.element),
            path: [],
          },
          message: verdict.message,
        };
      });

      results.push({
        actRuleId,
        engine: 'marlo',
        status: 'ok',
        verdicts,
        error: null,
        missingCapabilities: [],
        durationMs: Date.now() - ruleStarted,
      });
    } catch (error) {
      // Per rule, not per run. A rule that crashes must be visible as a crash, and it
      // must not take the other rules with it.
      results.push({
        actRuleId,
        engine: 'marlo',
        status: 'error',
        verdicts: [],
        error: error instanceof Error ? error.message : String(error),
        missingCapabilities: [],
        durationMs: Date.now() - ruleStarted,
      });
    }
  }

  return {
    engine: 'marlo',
    engineVersion: options.version,
    renderer: options.renderer,
    results,
    notRequested: [],
    durationMs: Date.now() - started,
  };
}
