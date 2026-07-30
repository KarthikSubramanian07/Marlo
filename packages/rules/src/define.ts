import type { ActRuleId, Capability, Outcome, SuccessCriterion } from '@marlo/schema';
import { findRule } from '@marlo/act';
import type { MarloDocument, MarloElement } from './dom.js';

/**
 * The rule interface. One rule is one call to `defineRule`, and the whole point is that
 * a contributor can write one without reading the pipeline.
 *
 * The shape enforces two things a rule author would otherwise have to remember.
 *
 * `requires` is not decoration. A rule that reads a computed style, a box, or paint
 * order and declares only `dom` will pass under the static renderer and fail in a
 * browser, which is a false negative Marlo cannot see. There is a test asserting that
 * every rule reading `element.computed` declares `layout`.
 *
 * An `expectation` returns an outcome per target, and returning `cantTell` is a
 * first-class answer rather than a failure to decide. A rule that guesses when its
 * inputs are incomplete is how a confident wrong finding gets published.
 */

export interface RuleTarget {
  readonly element: MarloElement;
  /** Why this element is in scope. Reported so a reader can check the applicability. */
  readonly note?: string;
}

export interface RuleVerdict {
  readonly outcome: Outcome;
  /** Addressed to the developer, in their terms. Not a restatement of the rule. */
  readonly message: string;
}

export interface MarloRule {
  readonly actId: ActRuleId;
  readonly name: string;
  readonly successCriteria: readonly SuccessCriterion[];
  readonly requires: readonly Capability[];
  /**
   * Whether Marlo may generate a fix for this rule at all, before the calibration
   * threshold is even consulted.
   *
   * `never` is a statement about the nature of the repair rather than about accuracy:
   * recolouring text is a design decision however precisely it is detected. Keeping it
   * on the rule rather than in a table elsewhere means a contributor states it while
   * they still have the rule's semantics in mind.
   */
  readonly fixability: 'auto' | 'context-dependent' | 'never';
  /** Elements this rule applies to. An empty list means the rule is inapplicable. */
  applicability(document: MarloDocument): readonly RuleTarget[];
  /** The verdict for one target. */
  expectation(target: RuleTarget, document: MarloDocument): RuleVerdict;
}

/**
 * Validates a rule at module load, so a malformed rule is a startup failure rather than
 * a wrong number in the calibration table.
 */
export function defineRule(rule: MarloRule): MarloRule {
  const published = findRule(rule.actId);
  if (published === undefined) {
    throw new Error(
      `Rule "${rule.actId}" is not a published ACT rule. Marlo may only implement rules in the ` +
        'vendored corpus, because the coverage denominator comes from there.',
    );
  }

  // The rule's own name and criteria have to match what ACT publishes. A rule
  // implementing 23a2a8 while calling itself something else would produce a report a
  // reader cannot cross-check against the specification.
  const expected = [...published.successCriteria].sort();
  const declared = [...rule.successCriteria].sort();
  if (expected.length > 0 && JSON.stringify(expected) !== JSON.stringify(declared)) {
    throw new Error(
      `Rule ${rule.actId} declares success criteria [${declared.join(', ')}] but ACT publishes ` +
        `[${expected.join(', ')}]. Copy them from the ACT rule rather than from your reading of it.`,
    );
  }

  if (!rule.requires.includes('dom')) {
    throw new Error(`Rule ${rule.actId} must declare the dom capability. Every rule needs it.`);
  }

  return rule;
}
