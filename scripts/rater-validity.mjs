#!/usr/bin/env node
/**
 * How accurate the raters behind corpus/real ground truth are, measured on cases whose
 * answer is known.
 *
 * The raters of the real pages also rated the ACT test cases for every rule Marlo
 * implements, under the same instructions and restrictions, with the files renamed so
 * nothing revealed the expected outcome. The W3C's expected outcomes were written by
 * people, so agreement with them measures the raters themselves. This script grades each
 * rater, and the adjudicated label (the raters' answer where they agreed, the resolver's
 * where they did not) the same way the real pages are adjudicated, against those outcomes.
 *
 * Usage:
 *   node scripts/rater-validity.mjs           write rater-validity.json and RATER-VALIDITY.md
 *   node scripts/rater-validity.mjs --check   fail if either file would change
 *
 * Inputs, in corpus/real/adjudication/rater-validity/:
 *   A.json, B.json      { rater, raterKind, raterModel, cases: [{ testcaseId, ruleId, answer, note }] }
 *   resolutions.json    { resolverKind, resolver, resolutions: [{ testcaseId, ruleId, answer, reasoning }] }
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANSWERS, RATER_KINDS, cohensKappa } from './adjudicate.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'corpus', 'real', 'adjudication', 'rater-validity');
const OUT_JSON = join(ROOT, 'corpus', 'real', 'adjudication', 'rater-validity.json');
const OUT_MD = join(ROOT, 'corpus', 'real', 'adjudication', 'RATER-VALIDITY.md');

const round = (value) => (value === null ? null : Math.round(value * 10_000) / 10_000);
const key = (c) => `${c.ruleId}/${c.testcaseId}`;

/** Wilson score interval at 95%, the same definition as packages/calibrate/src/analysis.ts. */
export function wilson(successes, n) {
  if (n === 0) return null;
  const z = 1.959963984540054;
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return {
    low: Math.max(0, Math.min(round(p), round(centre - half))),
    high: Math.min(1, Math.max(round(p), round(centre + half))),
  };
}

const proportion = (successes, n) => ({
  successes,
  n,
  value: n === 0 ? null : round(successes / n),
  interval: wilson(successes, n),
});

/**
 * Grades labels against expected outcomes.
 *
 * `agreement` counts an exact match, with `cantTell` never matching, because no expected
 * outcome in the ACT corpus is cantTell. Failure detection treats `failed` as the
 * positive class: precision over the cases labelled failed, recall over the cases
 * expected failed, which is the same reading the calibration table gives an engine.
 *
 * @param {{expected: string, answer: string}[]} pairs
 */
export function grade(pairs) {
  const confusion = {};
  for (const e of ['passed', 'failed', 'inapplicable']) {
    confusion[e] = Object.fromEntries(ANSWERS.map((a) => [a, 0]));
  }
  let agree = 0;
  let tp = 0;
  let labelledFailed = 0;
  let expectedFailed = 0;
  for (const { expected, answer } of pairs) {
    confusion[expected][answer] += 1;
    if (expected === answer) agree += 1;
    if (answer === 'failed') labelledFailed += 1;
    if (expected === 'failed') expectedFailed += 1;
    if (answer === 'failed' && expected === 'failed') tp += 1;
  }
  const { kappa } = cohensKappa(pairs.map((p) => [p.expected, p.answer]));
  return {
    cases: pairs.length,
    agreement: proportion(agree, pairs.length),
    kappa: round(kappa),
    failurePrecision: proportion(tp, labelledFailed),
    failureRecall: proportion(tp, expectedFailed),
    cantTell: pairs.filter((p) => p.answer === 'cantTell').length,
    confusion,
  };
}

function validateRater(sheet, expected, name) {
  const problems = [];
  if (!RATER_KINDS.includes(sheet.raterKind)) problems.push(`${name}: raterKind is not set`);
  if (sheet.raterKind === 'model' && !sheet.raterModel) problems.push(`${name}: no raterModel`);
  const seen = new Set();
  for (const c of sheet.cases ?? []) {
    const k = key(c);
    if (seen.has(k)) problems.push(`${name}: ${k} appears twice`);
    seen.add(k);
    if (!expected.has(k)) problems.push(`${name}: ${k} is not an ACT case of an implemented rule`);
    if (!ANSWERS.includes(c.answer)) problems.push(`${name}: ${k} has answer ${String(c.answer)}`);
  }
  for (const k of expected.keys()) if (!seen.has(k)) problems.push(`${name}: ${k} is missing`);
  return problems;
}

/**
 * Builds the report from the raters' answers, the resolutions and the expected outcomes.
 * Pure, so the tests can call it with small inputs.
 */
export function buildReport({ expected, a, b, resolutions, rules }) {
  const problems = [
    ...validateRater(a, expected, 'A.json'),
    ...validateRater(b, expected, 'B.json'),
  ];
  const byA = new Map(a.cases.map((c) => [key(c), c.answer]));
  const byB = new Map(b.cases.map((c) => [key(c), c.answer]));
  const resolved = new Map((resolutions?.resolutions ?? []).map((r) => [key(r), r.answer]));

  const adjudicated = new Map();
  for (const k of expected.keys()) {
    const left = byA.get(k);
    const right = byB.get(k);
    if (left === undefined || right === undefined) continue;
    if (left === right) {
      if (resolved.has(k)) problems.push(`resolutions.json: ${k} overrules two raters who agreed`);
      adjudicated.set(k, { answer: left, source: 'agreement' });
    } else if (resolved.has(k)) {
      adjudicated.set(k, { answer: resolved.get(k), source: 'resolution' });
    } else {
      problems.push(`resolutions.json: ${k} is a disagreement with no resolution`);
    }
  }
  if (problems.length > 0) return { problems };

  const pairsFor = (labels, filter = () => true) =>
    [...expected.entries()]
      .filter(([k]) => filter(k) && labels.has(k))
      .map(([k, e]) => ({
        expected: e,
        answer: typeof labels.get(k) === 'string' ? labels.get(k) : labels.get(k).answer,
      }));
  const ruleOf = (k) => k.split('/')[0];
  const agreed = new Set(
    [...adjudicated].filter(([, v]) => v.source === 'agreement').map(([k]) => k),
  );

  const interRater = cohensKappa([...expected.keys()].map((k) => [byA.get(k), byB.get(k)]));
  const report = {
    description:
      'Accuracy of the corpus/real raters on the ACT test cases of every rule Marlo implements, ' +
      "against the W3C's expected outcomes. Generated by scripts/rater-validity.mjs.",
    raters: [a, b].map((s) => ({ rater: s.rater, kind: s.raterKind, model: s.raterModel ?? null })),
    resolver: {
      kind: resolutions?.resolverKind ?? null,
      model: resolutions?.resolver ?? null,
    },
    cases: expected.size,
    interRater: {
      percentAgreement: round(interRater.percentAgreement),
      kappa: round(interRater.kappa),
      disagreements: expected.size - agreed.size,
    },
    graded: {
      A: grade(pairsFor(byA)),
      B: grade(pairsFor(byB)),
      adjudicated: grade(pairsFor(adjudicated)),
      /** How often two raters who agreed were both wrong. */
      whereRatersAgreed: grade(pairsFor(adjudicated, (k) => agreed.has(k))),
      whereResolved: grade(pairsFor(adjudicated, (k) => !agreed.has(k))),
    },
    perRule: rules.map((rule) => {
      const inRule = (k) => ruleOf(k) === rule.id;
      const g = grade(pairsFor(adjudicated, inRule));
      return {
        actRuleId: rule.id,
        name: rule.name,
        cases: g.cases,
        agreementA: grade(pairsFor(byA, inRule)).agreement.value,
        agreementB: grade(pairsFor(byB, inRule)).agreement.value,
        agreementAdjudicated: g.agreement.value,
        wrongAdjudicated: g.cases - g.agreement.successes,
      };
    }),
  };
  return { problems: [], report };
}

const pct = (p) => (p === null || p.value === null ? 'n/a' : `${(p.value * 100).toFixed(1)}%`);
const ci = (p) =>
  p === null || p.interval === null
    ? ''
    : ` (${(p.interval.low * 100).toFixed(1)} to ${(p.interval.high * 100).toFixed(1)})`;
const num = (v) => (v === null ? 'n/a' : v.toFixed(3));

export function renderMarkdown(report) {
  const g = report.graded;
  const who = (r) => (r.kind === 'model' ? `\`${r.model}\`` : 'a person');
  const row = (label, x) =>
    `| ${label} | ${String(x.cases)} | ${pct(x.agreement)}${ci(x.agreement)} | ${num(x.kappa)} | ` +
    `${pct(x.failurePrecision)} | ${pct(x.failureRecall)} | ${String(x.cantTell)} |`;
  const lines = [
    '# How accurate the raters are',
    '',
    'Generated by `node scripts/rater-validity.mjs` from `rater-validity/`. Do not edit.',
    '',
    `The ground truth for \`corpus/real\` comes from rater A (${who(report.raters[0])}), rater B ` +
      `(${who(report.raters[1])}) and, where they disagreed, a resolver ` +
      `(${report.resolver.kind === 'model' ? `\`${String(report.resolver.model)}\`` : 'a person'}). ` +
      'This page measures that process on cases whose answer is known: the same raters, ' +
      'under the same instructions and restrictions, rated every ACT test case of every rule ' +
      'Marlo implements, renamed so nothing revealed the expected outcome, and the ' +
      "disagreements went to the same resolver. The W3C's expected outcomes were written by " +
      'people, so agreement with them is an accuracy figure for the raters.',
    '',
    `${String(report.cases)} cases. The raters agreed with each other on ` +
      `${pct({ value: report.interRater.percentAgreement })} of them ` +
      `(Cohen's kappa ${num(report.interRater.kappa)}), and ${String(report.interRater.disagreements)} ` +
      'went to the resolver.',
    '',
    '| Labels | Cases | Agree with W3C (95% CI) | Kappa | Failure precision | Failure recall | cantTell |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    row('Rater A', g.A),
    row('Rater B', g.B),
    row('**Adjudicated**', g.adjudicated),
    row('Where A and B agreed', g.whereRatersAgreed),
    row('Where the resolver decided', g.whereResolved),
    '',
    'A `cantTell` never counts as agreement, because no ACT expected outcome is `cantTell`. ' +
      'Failure precision and recall treat `failed` as the positive class, as the calibration ' +
      'table does for an engine.',
    '',
    '**How to read this.** The adjudicated row is the error rate of the ground truth the ' +
      'real-page figures are graded against, measured on minimal test cases. Real pages are ' +
      'larger and messier, so it is a floor on that error, not an estimate of it. The test ' +
      'cases are public and may have been seen in training; the pages are public too.',
    '',
    '## Per rule',
    '',
    '| Rule | Name | Cases | Rater A | Rater B | Adjudicated | Wrong |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...report.perRule.map(
      (r) =>
        `| ${r.actRuleId} | ${r.name} | ${String(r.cases)} | ${pct({ value: r.agreementA })} | ` +
        `${pct({ value: r.agreementB })} | ${pct({ value: r.agreementAdjudicated })} | ${String(r.wrongAdjudicated)} |`,
    ),
    '',
    '## Confusion, adjudicated labels',
    '',
    '| Expected | passed | failed | cantTell | inapplicable |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(g.adjudicated.confusion).map(
      ([e, row2]) =>
        `| ${e} | ${String(row2.passed)} | ${String(row2.failed)} | ${String(row2.cantTell)} | ${String(row2.inapplicable)} |`,
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function main(argv) {
  const check = argv.includes('--check');
  const manifest = JSON.parse(readFileSync(join(ROOT, 'corpus', 'act', 'MANIFEST.json'), 'utf8'));
  const [{ IMPLEMENTED_RULES }, { findRule }] = await Promise.all([
    import('@marlo/rules'),
    import('@marlo/act'),
  ]);
  const implemented = new Set(IMPLEMENTED_RULES);
  const expected = new Map(
    manifest.testCases.filter((c) => implemented.has(c.ruleId)).map((c) => [key(c), c.expected]),
  );
  const rules = [...IMPLEMENTED_RULES].map((id) => ({ id, name: findRule(id)?.name ?? id }));
  const read = (name) =>
    existsSync(join(DIR, name)) ? JSON.parse(readFileSync(join(DIR, name), 'utf8')) : null;
  const a = read('A.json');
  const b = read('B.json');
  if (a === null || b === null) {
    console.error('rater-validity: A.json and B.json are both required.');
    process.exitCode = 1;
    return;
  }
  const { problems, report } = buildReport({
    expected,
    a,
    b,
    resolutions: read('resolutions.json'),
    rules,
  });
  if (problems.length > 0) {
    for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
    console.error(`rater-validity: ${String(problems.length)} problem(s), nothing written.`);
    process.exitCode = 1;
    return;
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const md = renderMarkdown(report);
  if (check) {
    const stale = [
      [OUT_JSON, json],
      [OUT_MD, md],
    ].filter(([file, text]) => !existsSync(file) || readFileSync(file, 'utf8') !== text);
    if (stale.length > 0) {
      console.error(
        `rater-validity --check: ${stale.map(([f]) => f.replace(`${ROOT}/`, '')).join(', ')} ` +
          'would change. Run `node scripts/rater-validity.mjs` and commit the result.',
      );
      process.exitCode = 1;
      return;
    }
    console.log('rater-validity --check: up to date.');
    return;
  }
  writeFileSync(OUT_JSON, json, 'utf8');
  writeFileSync(OUT_MD, md, 'utf8');
  const g = report.graded.adjudicated;
  console.log(
    `rater-validity: ${String(report.cases)} cases, adjudicated labels agree with the W3C on ` +
      `${pct(g.agreement)}, kappa ${num(g.kappa)}.`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
