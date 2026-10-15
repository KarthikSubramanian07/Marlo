import type { Severity } from '@marlo/schema';

/**
 * Severity per ACT rule.
 *
 * A judgment, and kept in one place so it can be argued with rather than being scattered
 * across thirty-five rule files. The reasoning behind the tiers, since a severity nobody
 * can question is a severity nobody trusts:
 *
 * `critical` is reserved for defects that stop somebody completing a task: an unnamed
 * control, a form field with no label, a viewport that forbids zoom.
 *
 * `serious` is a defect that degrades every interaction on the page without stopping it,
 * such as a missing document language, or one that actively misinforms, such as an invalid
 * ARIA value. Misinformation is ranked above absence deliberately: a screen reader user
 * can work around silence and cannot detect a lie.
 *
 * `moderate` is a real violation with a workaround. `advisory` is a finding Marlo cannot
 * be confident about, which is why the two rules that always return `cantTell` live there.
 */
export const SEVERITY_BY_RULE: Readonly<Record<string, Severity>> = Object.freeze({
  c487ae: 'critical',
  '97a4e1': 'critical',
  e086e5: 'critical',
  '59796f': 'critical',
  b4f0c3: 'critical',

  '23a2a8': 'serious',
  ffd0e9: 'serious',
  cae760: 'serious',
  '8fc3b6': 'serious',
  '7d6734': 'serious',
  b5c3f8: 'serious',
  '6a7281': 'serious',
  '674b10': 'serious',
  '4e8ab6': 'serious',
  '6cfa84': 'serious',
  bc659a: 'serious',
  bisz58: 'serious',
  '2779a5': 'serious',
  afw4f7: 'serious',

  bf051a: 'moderate',
  de46e4: 'moderate',
  '5b7ae0': 'moderate',
  '5f99a7': 'moderate',
  '5c01ea': 'moderate',
  ff89c9: 'moderate',
  bc4a75: 'moderate',
  '3ea0c8': 'moderate',
  e6952f: 'moderate',
  '09o5cg': 'moderate',
  '78fd32': 'moderate',
  '24afc2': 'moderate',
  '9e45ec': 'moderate',
  '46ca7f': 'moderate',

  e88epe: 'advisory',
  '9eb3f6': 'advisory',
});

export function severityOf(actRuleId: string): Severity {
  return SEVERITY_BY_RULE[actRuleId] ?? 'moderate';
}
