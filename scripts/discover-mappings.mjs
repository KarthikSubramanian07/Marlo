#!/usr/bin/env node
/**
 * Proposes engine-rule to ACT-rule mappings from evidence, for a human to review.
 *
 * WHY THIS EXISTS
 *
 * No accessibility engine publishes a mapping from its own rule identifiers to ACT
 * rule identifiers. RESEARCH.md §2 records the check: axe-core carries an `ACT` tag on
 * 85 of its 105 rules and no ACT ids; Alfa's rules carry WCAG criteria, techniques and
 * European Accessibility Act references and never an ACT rule; HTML CodeSniffer
 * carries technique codes. Writing that mapping is the labour this project consists
 * of, and it is the second-highest-value contribution surface after new rules.
 *
 * Writing it from memory produces confident wrong entries. So this script runs an
 * engine over every official test case for a rule and reports which of the engine's
 * own rules fired on the failing examples and, crucially, on the passing ones.
 *
 * IT PROPOSES. IT DOES NOT DECIDE.
 *
 * The output is a candidate list with the counts behind it, for a human to turn into a
 * `MappingEntry` with a `kind` and a `note`. That is deliberate. `kind` is a judgment
 * about what the engine's rule means, and correlation over a few dozen examples does
 * not establish meaning: an engine rule that happens to fire on the same pages can be
 * checking something else entirely. The calibration harness then measures whatever a
 * human committed, and contradicts an optimistic `exact`.
 *
 * READING THE OUTPUT
 *
 *   f  fired on a failing example. Wanted.
 *   p  fired on a passing example. A false positive against this rule.
 *   i  fired on an inapplicable example. Also a false positive.
 *   ct returned cantTell. Neither, and it costs strict recall.
 *
 * A candidate with high `f`, zero `p` and zero `i` is a strong `exact` proposal. High
 * `f` with some `p` is usually `superset`: the engine is checking something broader.
 * Low `f` with zero `p` is usually `partial`.
 *
 * Usage:
 *   node scripts/discover-mappings.mjs --engine axe [--rule b5c3f8] [--json out.json]
 *   node scripts/discover-mappings.mjs --engine htmlcs
 *
 * Alfa is not supported here: it needs the DOM installed as globals before its
 * modules are imported, which is what @marlo/render's withDomGlobals does, so its
 * discovery runs through the calibration harness instead.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const engineName = arg('engine') ?? 'axe';
const onlyRule = arg('rule');
const jsonOut = arg('json');

if (!['axe', 'htmlcs'].includes(engineName)) {
  console.error(`--engine must be axe or htmlcs. Alfa runs through the calibration harness.`);
  process.exit(2);
}

// happy-dom is a dependency of @marlo/render, not of this script, because the
// dependency rules keep DOM construction behind the render seam. Resolving from there
// rather than adding a root dependency keeps that boundary honest.
const { Window } = await import(
  require.resolve('happy-dom', { paths: [resolve(ROOT, 'packages/render')] })
);

const enginePaths = [resolve(ROOT, 'packages/engines')];
const engineSource =
  engineName === 'axe'
    ? readFileSync(require.resolve('axe-core', { paths: enginePaths }), 'utf8')
    : readFileSync(
        require.resolve('html_codesniffer/build/HTMLCS.js', { paths: enginePaths }),
        'utf8',
      );

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'corpus/act/MANIFEST.json'), 'utf8'));

const byRule = new Map();
for (const testCase of manifest.testCases) {
  if (onlyRule !== undefined && testCase.ruleId !== onlyRule) continue;
  const list = byRule.get(testCase.ruleId) ?? [];
  list.push(testCase);
  byRule.set(testCase.ruleId, list);
}

if (byRule.size === 0) {
  console.error(onlyRule === undefined ? 'no test cases found' : `no test cases for ${onlyRule}`);
  process.exit(2);
}

const SETTINGS = {
  disableJavaScriptFileLoading: true,
  disableCSSFileLoading: true,
  enableImageFileLoading: false,
  disableIframePageLoading: true,
  handleDisabledFileLoadingAsSuccess: true,
  suppressInsecureJavaScriptEnvironmentWarning: true,
};

/** Normalises an HTML CodeSniffer code to criterion plus technique. */
function normaliseHtmlcsCode(code) {
  const parts = code.split('.');
  if (parts.length < 5) return code;
  return `${parts[3] ?? ''}.${parts.slice(4).join('.')}`;
}

async function evaluate(html) {
  const window = new Window({ url: 'https://marlo.invalid/', settings: SETTINGS });
  window.document.write(html);
  await Promise.race([
    window.happyDOM.waitUntilComplete(),
    new Promise((r) => {
      setTimeout(r, 1500);
    }),
  ]);

  try {
    window.eval(engineSource);
    if (engineName === 'axe') {
      const result = await window.eval(
        `axe.run(document, {resultTypes:['violations','incomplete'],reporter:'v2',iframes:false})`,
      );
      return {
        failed: result.violations.map((v) => v.id),
        cantTell: result.incomplete.map((v) => v.id),
      };
    }
    const messages = await window.eval(
      `new Promise((res) => { HTMLCS.process('WCAG2AA', document, () => res(HTMLCS.getMessages())); })`,
    );
    return {
      failed: messages.filter((m) => m.type === 1).map((m) => normaliseHtmlcsCode(m.code)),
      cantTell: messages.filter((m) => m.type !== 1).map((m) => normaliseHtmlcsCode(m.code)),
    };
  } catch (error) {
    return { error: String(error instanceof Error ? error.message : error).slice(0, 160) };
  } finally {
    await window.happyDOM.close();
  }
}

const report = {};
let done = 0;

for (const [actRuleId, cases] of [...byRule].sort((a, b) => a[0].localeCompare(b[0]))) {
  const candidates = new Map();
  const errors = [];

  for (const testCase of cases) {
    const html = readFileSync(resolve(ROOT, 'corpus/act', testCase.path), 'utf8');
    const outcome = await evaluate(html);

    if (outcome.error !== undefined) {
      errors.push(`${testCase.testcaseId}: ${outcome.error}`);
      continue;
    }

    const bump = (id, field) => {
      const stat = candidates.get(id) ?? { f: 0, p: 0, i: 0, ct: 0 };
      stat[field] += 1;
      candidates.set(id, stat);
    };

    for (const id of new Set(outcome.failed)) {
      bump(id, testCase.expected === 'failed' ? 'f' : testCase.expected === 'passed' ? 'p' : 'i');
    }
    for (const id of new Set(outcome.cantTell)) bump(id, 'ct');
  }

  const counts = { passed: 0, failed: 0, inapplicable: 0 };
  for (const testCase of cases) counts[testCase.expected] += 1;

  const ranked = [...candidates]
    .map(([engineRuleId, stat]) => ({
      engineRuleId,
      ...stat,
      // Recall over the rule's failing examples, and whether it stayed quiet on the
      // ones it should have.
      recall: counts.failed === 0 ? null : stat.f / counts.failed,
      clean: stat.p === 0 && stat.i === 0,
    }))
    .filter((c) => c.f > 0 || c.ct > 0)
    .sort((a, b) => b.f - a.f || b.ct - a.ct);

  report[actRuleId] = { counts, errors, candidates: ranked };

  done += 1;
  if (done % 10 === 0 || done === byRule.size) {
    process.stderr.write(`  ${String(done)}/${String(byRule.size)} rules\n`);
  }
}

if (jsonOut !== undefined) {
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${jsonOut}`);
}

console.log(`\nCandidate mappings for ${engineName}. Proposals, not conclusions.\n`);
console.log('  f = fired on a failing example (wanted)');
console.log('  p = fired on a passing example (a false positive against this rule)');
console.log('  i = fired on an inapplicable example (also a false positive)');
console.log('  ct = returned cantTell (costs strict recall)\n');

const strong = [];
const weak = [];

for (const [actRuleId, entry] of Object.entries(report)) {
  if (entry.candidates.length === 0) continue;
  const line = `${actRuleId} [failing=${String(entry.counts.failed)}]  ${entry.candidates
    .slice(0, 4)
    .map(
      (c) => `${c.engineRuleId}(f${String(c.f)}/p${String(c.p)}/i${String(c.i)}/ct${String(c.ct)})`,
    )
    .join('  ')}`;
  const best = entry.candidates[0];
  if (best !== undefined && best.clean && best.recall !== null && best.recall >= 0.8) {
    strong.push(line);
  } else {
    weak.push(line);
  }
  if (entry.errors.length > 0) {
    weak.push(`    ${String(entry.errors.length)} test cases errored, first: ${entry.errors[0]}`);
  }
}

console.log(
  `STRONG: clean on every non-failing example, at least 80% recall (${String(strong.length)})`,
);
for (const line of strong) console.log(`  ${line}`);
console.log(`\nNEEDS JUDGMENT (${String(weak.length)})`);
for (const line of weak) console.log(`  ${line}`);

console.log(
  `\nNothing here is a mapping until a human writes the kind and the note. A rule that\n` +
    'happens to fire on the same pages may be checking something else entirely.',
);
