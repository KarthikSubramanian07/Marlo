/**
 * @marlo/rules
 *
 * Marlo's own ACT rule implementations. One rule is one file and one registry line.
 *
 * Pure: no filesystem, no network, no DOM library. A rule is a function over the
 * structural interfaces in `dom.ts`, so it runs against a fixture built by hand in a
 * test with no renderer anywhere. That is what makes "one rule, one function, one
 * fixture set" true rather than aspirational.
 *
 * It cannot import @marlo/engines. A dependency rule enforces that, per DECISIONS.md
 * D-008: Marlo's engine is graded in the same calibration table as its peers, so it
 * must not be able to observe them while deciding. The sibling PDF project's worst
 * defect survived precisely because its auditor could see what its writer had done.
 *
 * Two habits run through the rules and are worth knowing before reading one:
 *
 * `cantTell` is a real answer. Where a verdict would depend on something outside the
 * DOM, the rule says so and explains what is missing. Marlo's recall suffers and the
 * calibration table publishes that cost, which is a better trade than a confident wrong
 * finding.
 *
 * `requires` is honest. The contrast rules declare `layout` and `paint`, so under the
 * default renderer they report `unsupported` instead of a verdict computed from styles
 * that were never resolved.
 */

export type { ComputedStyle, MarloAttribute, MarloDocument, MarloElement } from './dom.js';
export {
  ancestors,
  attr,
  attrNode,
  descendants,
  findAll,
  findFirst,
  hasAttr,
  isFocusable,
  isHiddenFromAssistiveTech,
  normalise,
  walk,
} from './dom.js';

export type { AccessibleName, NameConfidence } from './accname.js';
export { accessibleName, hasEmptyAccessibleName } from './accname.js';

export type { MarloRule, RuleTarget, RuleVerdict } from './define.js';
export { defineRule } from './define.js';

export { IMPLEMENTED_RULES, MARLO_RULES, findMarloRule, requiredCapabilities } from './registry.js';

export type { FixtureOptions } from './fixture.js';
export { fixture } from './fixture.js';

export type { ParseOptions, SourceElement } from './parse.js';
export { buildDocument } from './parse.js';

export type { EvaluateOptions, MarloVerdictDetail } from './evaluate.js';
export { evaluateRules } from './evaluate.js';

export { ARIA_ATTRIBUTES, ARIA_ROLES, explicitRole } from './rules/aria.js';
export { classifyLanguageTag } from './rules/language.js';
