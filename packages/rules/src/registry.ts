import type { ActRuleId, Capability } from '@marlo/schema';
import type { MarloRule } from './define.js';
import {
  elementLangValid,
  langAndXmlLangMatch,
  pageHasLang,
  pageLangValid,
} from './rules/language.js';
import {
  ariaAttributeDefined,
  ariaHiddenNoFocusable,
  ariaPropertyPermitted,
  ariaValueValid,
  requiredContextRole,
  requiredOwnedElements,
  roleRequiredProperties,
  roleValueValid,
} from './rules/aria.js';
import {
  buttonHasName,
  formFieldHasName,
  headingHasName,
  iframeHasName,
  imageButtonHasName,
  imageHasName,
  linkHasName,
  objectHasName,
  pageHasTitle,
  svgHasName,
} from './rules/names.js';
import {
  decorativeImageNotExposed,
  decorativeNotExposed,
  filenameNotName,
  metaRefreshNoDelay,
  metaRefreshStrict,
  noDuplicateAttribute,
  uniqueId,
  viewportAllowsZoom,
} from './rules/structure.js';
import {
  letterSpacingNotImportant,
  lineHeightNotImportant,
  wordSpacingNotImportant,
} from './rules/spacing.js';
import { enhancedContrast, minimumContrast } from './rules/contrast.js';

/**
 * Every rule Marlo implements.
 *
 * The length of this array is the numerator of the coverage fraction. The denominator
 * comes from the vendored corpus and is not configurable. A test asserts the two agree
 * with what the README says, so the fraction cannot drift.
 *
 * Adding a rule means adding a file under `rules/` and one line here. That is the whole
 * ceremony, and keeping it that way is the point: the contribution funnel is new rules,
 * and a funnel with a registration step in four places is a funnel nobody uses.
 */
export const MARLO_RULES: readonly MarloRule[] = Object.freeze([
  // Language. The most reliably fixable group.
  pageHasLang,
  pageLangValid,
  elementLangValid,
  langAndXmlLangMatch,

  // ARIA validity. Where a wrong attribute does active harm.
  ariaAttributeDefined,
  roleValueValid,
  ariaValueValid,
  ariaPropertyPermitted,
  roleRequiredProperties,
  requiredContextRole,
  requiredOwnedElements,
  ariaHiddenNoFocusable,

  // Accessible names. Detected precisely, fixed only where the page supplies meaning.
  pageHasTitle,
  imageHasName,
  linkHasName,
  buttonHasName,
  formFieldHasName,
  headingHasName,
  iframeHasName,
  imageButtonHasName,
  objectHasName,
  svgHasName,

  // Structure and metadata.
  uniqueId,
  noDuplicateAttribute,
  metaRefreshNoDelay,
  metaRefreshStrict,
  viewportAllowsZoom,
  decorativeImageNotExposed,
  decorativeNotExposed,
  filenameNotName,

  // Text spacing.
  lineHeightNotImportant,
  letterSpacingNotImportant,
  wordSpacingNotImportant,

  // Contrast. Located, never fixed, and unsupported without layout.
  minimumContrast,
  enhancedContrast,
]);

const BY_ID: ReadonlyMap<string, MarloRule> = new Map(MARLO_RULES.map((r) => [r.actId, r]));

/** The ACT rules Marlo implements. The coverage numerator. */
export const IMPLEMENTED_RULES: readonly ActRuleId[] = Object.freeze(
  MARLO_RULES.map((r) => r.actId).sort(),
);

export function findMarloRule(actId: string): MarloRule | undefined {
  return BY_ID.get(actId);
}

/** Every capability any implemented rule needs. */
export function requiredCapabilities(): readonly Capability[] {
  const all = new Set<Capability>();
  for (const rule of MARLO_RULES) for (const c of rule.requires) all.add(c);
  return [...all].sort();
}
