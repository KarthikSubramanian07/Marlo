#!/usr/bin/env node
/**
 * Generates packages/act/src/rules.generated.ts from corpus/act/MANIFEST.json.
 *
 * @marlo/act is a pure package: no filesystem, no network, asserted by
 * dependency-cruiser. So the rule index cannot be read at import time, and it is
 * generated into source instead.
 *
 * The obvious alternative, importing MANIFEST.json directly, was rejected: the
 * manifest carries a digest for all 1134 test cases, which is 300 KiB of data no
 * consumer of the rule index needs, and it lives outside the package's rootDir.
 *
 * Drift is caught rather than trusted. rules.generated.test.ts reads the manifest
 * and asserts the generated file agrees with it, field by field. That test is the
 * one narrow reason a pure package's tests are permitted filesystem access.
 *
 * Usage: node scripts/generate-act-index.mjs [--check]
 *   --check  exit non-zero if the generated file is stale, without writing
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST = resolve(ROOT, 'corpus/act/MANIFEST.json');
const TARGET = resolve(ROOT, 'packages/act/src/rules.generated.ts');

const checkOnly = process.argv.includes('--check');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

/**
 * ACT rules declare accessibility requirements as keys like `wcag20:1.3.1`,
 * `wcag21:1.4.13`, `wcag-technique:H25` and `aria12:prohibitedattributes`. Only
 * the WCAG success criteria are structured enough to route on, so those are
 * extracted and the rest is preserved verbatim under `otherRequirements` rather
 * than dropped. Dropping them would make a rule look like it maps to fewer
 * requirements than it does.
 */
function splitRequirements(requirements) {
  const criteria = [];
  const other = [];
  for (const requirement of requirements) {
    const wcag = /^wcag\d+:(\d+\.\d+\.\d+)$/.exec(requirement);
    if (wcag) criteria.push(wcag[1]);
    else other.push(requirement);
  }
  return { criteria: [...new Set(criteria)].sort(), other: other.sort() };
}

const rules = [...manifest.rules]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((rule) => {
    const { criteria, other } = splitRequirements(rule.requirements);
    const counts = rule.testCases;
    return {
      id: rule.id,
      name: rule.name,
      ruleType: rule.ruleType,
      successCriteria: criteria,
      otherRequirements: other,
      inputAspects: rule.inputAspects,
      testCases: {
        passed: counts.passed,
        failed: counts.failed,
        inapplicable: counts.inapplicable,
        total: counts.passed + counts.failed + counts.inapplicable,
      },
    };
  });

const body = `/**
 * GENERATED FILE. Do not edit.
 *
 * Produced by scripts/generate-act-index.mjs from corpus/act/MANIFEST.json.
 * Regenerate with \`pnpm act:index\`; \`pnpm act:index --check\` fails if this
 * file is stale, and CI runs the check.
 *
 * It is generated rather than read at import time because @marlo/act is pure:
 * no filesystem, no network, asserted by dependency-cruiser. rules.generated.test.ts
 * reads the manifest and asserts this file agrees with it field by field, so the
 * two cannot drift.
 *
 * Corpus retrieved ${manifest.retrieved}. ${String(manifest.totals.rules)} published rules,
 * ${String(manifest.totals.rulesWithTestCases)} with official test cases, ${String(manifest.totals.testCases)} test cases.
 */

/** One published ACT rule, as its own front matter declares it. */
export interface ActRuleRecord {
  /** Six-character identifier assigned by the ACT-Rules Community. */
  readonly id: string;
  readonly name: string;
  readonly ruleType: 'atomic' | 'composite';
  /** WCAG success criteria, extracted from accessibility_requirements. */
  readonly successCriteria: readonly string[];
  /**
   * Requirements that are not WCAG success criteria: techniques, ARIA terms,
   * European Accessibility Act references. Kept verbatim rather than dropped, so a
   * rule does not appear to map to fewer requirements than it does.
   */
  readonly otherRequirements: readonly string[];
  /** What the rule needs to look at. From the rule's input_aspects. */
  readonly inputAspects: readonly string[];
  /** Official test case counts. A total of zero means the rule is unmeasurable. */
  readonly testCases: {
    readonly passed: number;
    readonly failed: number;
    readonly inapplicable: number;
    readonly total: number;
  };
}

/** When the vendored corpus this index was generated from was retrieved. */
export const CORPUS_RETRIEVED = '${manifest.retrieved}';

/**
 * Every published ACT rule, sorted by identifier.
 *
 * The length of this array is the denominator of every coverage fraction Marlo
 * prints. It is not a configurable number.
 */
export const ACT_RULES: readonly ActRuleRecord[] = Object.freeze([
${rules
  .map(
    (r) => `  Object.freeze({
    id: '${r.id}',
    name: ${JSON.stringify(r.name)},
    ruleType: '${r.ruleType}',
    successCriteria: Object.freeze([${r.successCriteria.map((c) => `'${c}'`).join(', ')}]),
    otherRequirements: Object.freeze([${r.otherRequirements.map((c) => `'${c}'`).join(', ')}]),
    inputAspects: Object.freeze([${r.inputAspects.map((c) => JSON.stringify(c)).join(', ')}]),
    testCases: Object.freeze({ passed: ${String(r.testCases.passed)}, failed: ${String(r.testCases.failed)}, inapplicable: ${String(r.testCases.inapplicable)}, total: ${String(r.testCases.total)} }),
  }),`,
  )
  .join('\n')}
]);
`;

const existing = (() => {
  try {
    return readFileSync(TARGET, 'utf8');
  } catch {
    return null;
  }
})();

if (checkOnly) {
  if (existing !== body) {
    console.error('packages/act/src/rules.generated.ts is stale.');
    console.error('Run `pnpm act:index`. A generated index that disagrees with the corpus');
    console.error('means the coverage denominator and the rule metadata are not the ones');
    console.error('the calibration numbers were computed against.');
    process.exit(1);
  }
  console.log(`act:index --check: current (${String(rules.length)} rules).`);
  process.exit(0);
}

if (existing === body) {
  console.log(`act:index: unchanged (${String(rules.length)} rules).`);
} else {
  writeFileSync(TARGET, body, 'utf8');
  console.log(`act:index: wrote ${String(rules.length)} rules.`);
}
