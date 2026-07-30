import type { ActRuleRecord } from './rules.generated.js';
import { ACT_RULES } from './rules.generated.js';

/**
 * Lookups over the published rule index, and the coverage arithmetic that rests on
 * it.
 *
 * The index is generated from the vendored corpus manifest, so `ACT_RULES.length`
 * is the real number of published ACT rules rather than a figure someone typed. It
 * is the denominator of every coverage fraction Marlo prints and it is not
 * configurable.
 */

const BY_ID: ReadonlyMap<string, ActRuleRecord> = new Map(ACT_RULES.map((r) => [r.id, r]));

/** The denominator. */
export const PUBLISHED_ACT_RULE_COUNT = ACT_RULES.length;

/** Rules that carry official test cases, and can therefore be calibrated. */
export const MEASURABLE_ACT_RULES: readonly ActRuleRecord[] = Object.freeze(
  ACT_RULES.filter((r) => r.testCases.total > 0),
);

/**
 * Rules with no official test cases.
 *
 * Three at the time of writing. They can be implemented and they cannot be
 * calibrated, and the difference has to be stated rather than left as a blank that
 * a reader will interpret as a zero.
 */
export const UNMEASURABLE_ACT_RULES: readonly string[] = Object.freeze(
  ACT_RULES.filter((r) => r.testCases.total === 0).map((r) => r.id),
);

/** A rule by identifier, or undefined. Undefined rather than a throw: callers validate. */
export function findRule(actRuleId: string): ActRuleRecord | undefined {
  return BY_ID.get(actRuleId);
}

/** Whether an identifier names a published ACT rule. */
export function isPublishedRule(actRuleId: string): boolean {
  return BY_ID.has(actRuleId);
}

/**
 * Every rule touching a given WCAG success criterion.
 *
 * Used by the report surfaces, where a reader auditing against one criterion wants
 * to know which rules speak to it and, by omission, which do not.
 */
export function rulesForCriterion(criterion: string): readonly ActRuleRecord[] {
  return ACT_RULES.filter((r) => r.successCriteria.includes(criterion));
}

/** Every success criterion any published rule maps to, sorted. */
export function allCoveredCriteria(): readonly string[] {
  const criteria = new Set<string>();
  for (const rule of ACT_RULES) for (const c of rule.successCriteria) criteria.add(c);
  return Object.freeze([...criteria].sort(compareCriteria));
}

/**
 * Numeric ordering for success criteria, so 1.4.10 sorts after 1.4.9 rather than
 * before it as a string comparison would put it.
 */
export function compareCriteria(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
