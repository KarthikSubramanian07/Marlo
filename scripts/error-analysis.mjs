#!/usr/bin/env node
/**
 * Why Marlo's own engine is wrong on the real pages, cell by cell.
 *
 * The calibration table grades Marlo's engine on the resolved real-page cells and
 * publishes totals. This script names every cell behind those totals: each false positive
 * and each false negative, what Marlo said, what the raters said, and a root cause from
 * the list below. Every wrong cell must match exactly one cause, so an engine change that
 * moves a cell cannot pass silently.
 *
 * It also reruns Marlo in headless Chromium, so the report can say which errors belong to
 * the static renderer rather than to a rule. That run is a diagnostic for Marlo alone. The
 * published comparison between engines uses the static renderer for all four, and nothing
 * here changes it.
 *
 * Usage:
 *   node scripts/error-analysis.mjs --scan    run Marlo on every real page with both renderers,
 *                                             write calibration/real-marlo-verdicts.json, then report
 *   node scripts/error-analysis.mjs           write error-analysis.json and ERROR-ANALYSIS.md
 *   node scripts/error-analysis.mjs --check   fail if either would change, or if the verdicts no
 *                                             longer reproduce the calibration table
 *
 * `--scan` needs a build (`pnpm build`) and Playwright's Chromium. The other two read
 * committed files only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { wilson } from './rater-validity.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ADJ = join(ROOT, 'corpus', 'real', 'adjudication');
const VERDICTS = join(ROOT, 'calibration', 'real-marlo-verdicts.json');
const OUT_JSON = join(ROOT, 'calibration', 'error-analysis.json');
const OUT_MD = join(ROOT, 'calibration', 'ERROR-ANALYSIS.md');
const RENDERERS = ['static', 'browser'];

const key = (page, rule) => `${page}/${rule}`;
const round = (v) => (v === null ? null : Math.round(v * 10_000) / 10_000);

/**
 * Root causes, decided by reading the page, Marlo's message and both raters' notes for
 * each wrong cell. `family` groups them for the summary. A cause matches on rule, the
 * direction of the error, Marlo's outcome and, where one rule has two causes, the page.
 */
export const CAUSES = [
  {
    id: 'idref-exception',
    family: 'rule logic',
    kind: 'FP',
    match: (r) => r.rule === '6a7281',
    title: 'Fails an ID reference whose target is missing',
    detail:
      'Marlo fails `aria-controls`, `aria-labelledby` or `aria-describedby` when no element ' +
      'has the referenced id. The ACT rule says, as an exception, that ID Reference values ' +
      'need no referenced element, and leaves missing targets to a separate rule (in6db8). On ' +
      'three pages the target does exist and the static renderer lost it, which only adds to ' +
      'the count.',
  },
  {
    id: 'hidden-applicability',
    family: 'rule logic',
    kind: 'FP',
    match: (r) => r.rule === '6cfa84' || (r.rule === '2ee8b8' && r.page !== 'settings-01'),
    title: 'Ignores display:none when deciding applicability',
    detail:
      'Links inside a `display:none` panel are counted as focusable content of an ' +
      '`aria-hidden` region (6cfa84), and `display:none` buttons are checked for their visible ' +
      'label (2ee8b8). The browser renderer resolves the style and Marlo still flags them, so ' +
      'the rule, not the renderer, skips the visibility test.',
  },
  {
    id: 'renderer-hidden',
    family: 'renderer',
    kind: 'FP',
    match: (r) =>
      (r.rule === 'bc4a75' && r.actual === 'failed') ||
      (r.rule === 'e086e5' && r.page !== 'shop-03') ||
      r.rule === '97a4e1',
    title: 'Evaluates an element a stylesheet hides',
    detail:
      'A listbox, menu, search field or button is hidden by a page stylesheet. The static ' +
      'renderer does no layout and reports it as present, so Marlo checks something nobody ' +
      'can perceive. In headless Chromium the element is hidden and the error goes away.',
  },
  {
    id: 'renderer-generated-content',
    family: 'renderer',
    kind: 'FP',
    match: (r) => r.rule === 'c487ae' && r.actual === 'failed',
    title: 'Cannot see CSS generated content in a name',
    detail:
      'Citation backlinks are named only by a `::before` counter (a, b, c). The accessible ' +
      'name computation includes generated content; the static renderer has none, so the ' +
      'links look unnamed. In Chromium Marlo abstains instead of failing.',
  },
  {
    id: 'abbreviation-exception',
    family: 'rule logic',
    kind: 'FP',
    match: (r) => r.rule === '2ee8b8' && r.page === 'settings-01',
    title: 'Misses the abbreviation exception in label-in-name',
    detail:
      'The visible labels "EN" and "UI Designer" contain abbreviations, which the ' +
      "rule's applicability excludes. Marlo applies the rule and fails both links.",
  },
  {
    id: 'placeholder-name',
    family: 'rule logic',
    kind: 'FP',
    match: (r) => r.rule === 'e086e5' && r.page === 'shop-03',
    title: 'Does not accept a placeholder as an accessible name',
    detail:
      'HTML-AAM lets `placeholder` supply a name when nothing else does, so the field has a ' +
      'non-empty name and passes. Marlo treats the placeholder as no name. It is weak ' +
      'labelling, but the rule asks only for a non-empty name.',
  },
  {
    id: 'dpub-roles',
    family: 'rule logic',
    kind: 'FP',
    match: (r) => r.rule === '674b10',
    title: 'Does not know DPUB-ARIA roles',
    detail:
      '`role="doc-noteref"` is a valid DPUB-ARIA role, which the rule counts. Marlo checks ' +
      'only the WAI-ARIA role list.',
  },
  {
    id: 'separator-focusable',
    family: 'rule logic',
    kind: 'FP',
    match: (r) => r.rule === '4e8ab6',
    title: 'Requires aria-valuenow on a non-focusable separator',
    detail:
      'Only a focusable separator is a widget with required value properties. Marlo requires ' +
      '`aria-valuenow` on an `li role="separator"` that is not focusable.',
  },
  {
    id: 'repeated-content',
    family: 'abstention',
    kind: 'FN',
    match: (r) =>
      r.rule === 'ye5d6e' || r.rule === 'cf77f2' || (r.rule === 'b40fd1' && r.actual !== 'passed'),
    title: 'Cannot tell what repeats across pages',
    detail:
      'Bypass rules turn on whether a block repeats on other pages of the site, which one ' +
      'page cannot show. Marlo answers cantTell; the raters judged the site header repeated ' +
      'and found no skip link, landmark or other way past it.',
  },
  {
    id: 'landmark-first-content',
    family: 'rule logic',
    kind: 'FN',
    match: (r) => r.rule === 'b40fd1' && r.actual === 'passed',
    title: 'Passes any main landmark',
    detail:
      'Marlo passes when a main landmark exists. The rule needs a landmark whose first ' +
      'perceivable content is non-repeated, and on these pages `main` opens with the ' +
      'repeated header or logo.',
  },
  {
    id: 'decorative-judgment',
    family: 'abstention',
    kind: 'FN',
    match: (r) => r.rule === 'e88epe' && r.actual === 'cantTell',
    title: 'Cannot tell whether a hidden image is decorative',
    detail:
      'Whether an image hidden from assistive technology carries information is a judgment ' +
      'about its content. Marlo asks for a person to check; the raters found brand logos, ' +
      'close glyphs and a search icon whose meaning was otherwise lost.',
  },
  {
    id: 'svg-not-considered',
    family: 'rule logic',
    kind: 'FN',
    match: (r) => r.rule === 'e88epe' && r.actual !== 'cantTell',
    title: 'Looks only at img elements, not inline svg',
    detail:
      'The failing images are inline `svg` elements (a licence logo, a close icon, a store ' +
      'logo) that are `aria-hidden` or have no name. Marlo finds no applicable image and ' +
      'answers inapplicable.',
  },
  {
    id: 'image-name-abstention',
    family: 'abstention',
    kind: 'FN',
    match: (r) => r.rule === 'c487ae' && r.actual !== 'failed',
    title: 'Abstains on a link named only by an image',
    detail:
      'A link holds only an `img` with no alt or an `svg` with no title, so its name is empty. ' +
      'Marlo abstains because an image contributes to the name and it does not trust the ' +
      "renderer's answer, which costs a failure the raters found unambiguous.",
  },
  {
    id: 'implicit-role',
    family: 'abstention',
    kind: 'FN',
    match: (r) => r.rule === '5c01ea',
    title: 'Does not compute the implicit role of every element',
    detail:
      '`aria-expanded` on a `label` and on a `span` with no role is not permitted. Deciding ' +
      'that needs the implicit role, which Marlo does not compute for every element, so it ' +
      'abstains.',
  },
  {
    id: 'aria-1-3',
    family: 'specification version',
    kind: 'FN',
    match: (r) => r.rule === '5f99a7',
    title: 'Accepts aria-description, which ARIA 1.2 does not define',
    detail:
      'The ACT rule pins WAI-ARIA 1.2. `aria-description` exists only in the 1.3 draft, and ' +
      "Marlo's attribute list includes it. Browsers support it, so this is a disagreement " +
      'about the specification version more than a defect.',
  },
  {
    id: 'owned-elements',
    family: 'rule logic',
    kind: 'FN',
    match: (r) => r.rule === 'bc4a75' && r.actual !== 'failed',
    title: 'Misses an owned element of the wrong role',
    detail:
      'A list owns headings and separators, and a table owns a `caption`, which ARIA 1.2 does ' +
      'not list among its required owned elements. Marlo passes the list and finds the table ' +
      'inapplicable.',
  },
];

/** The outcome a verdict list collapses to, as @trymarlo/engines collapses it. */
export function collapse(verdicts) {
  const outcomes = new Set(verdicts.map((v) => v.outcome));
  if (outcomes.has('failed')) return 'failed';
  if (outcomes.has('cantTell')) return 'cantTell';
  if (outcomes.has('passed')) return 'passed';
  return 'inapplicable';
}

/** A strict confusion count, the calibration table's grading: cantTell is never a failure. */
function confusion(pairs) {
  const t = { truePositives: 0, falsePositives: 0, falseNegatives: 0, trueNegatives: 0 };
  for (const { truth, actual } of pairs) {
    const expected = truth === 'failed';
    const reported = actual === 'failed';
    if (expected && reported) t.truePositives += 1;
    else if (reported) t.falsePositives += 1;
    else if (expected) t.falseNegatives += 1;
    else t.trueNegatives += 1;
  }
  const rate = (s, n) => ({ value: n === 0 ? null : round(s / n), interval: wilson(s, n) });
  return {
    ...t,
    precision: rate(t.truePositives, t.truePositives + t.falsePositives),
    recall: rate(t.truePositives, t.truePositives + t.falseNegatives),
    falsePositiveRate: rate(t.falsePositives, t.falsePositives + t.trueNegatives),
  };
}

/**
 * Builds the report from the verdicts and the ground truth.
 *
 * `table` is calibration/table.json; its real-page entries for Marlo are the published
 * figures, and the static verdicts must reproduce them exactly.
 */
export function buildReport({ verdicts, resolved, sheets, resolutions, table, causes = CAUSES }) {
  const problems = [];
  const truth = new Map(resolved.cells.map((c) => [key(c.page, c.rule), c]));
  const notes = (rater) =>
    new Map((sheets[rater]?.cells ?? []).map((c) => [key(c.page, c.rule), c.note ?? '']));
  const noteA = notes('A');
  const noteB = notes('B');
  const reasoning = new Map(
    (resolutions?.resolutions ?? []).map((r) => [key(r.page, r.rule), r.reasoning ?? '']),
  );

  const outcomeOf = (renderer, k) => {
    const cell = verdicts[renderer]?.[k];
    if (cell === undefined) return 'missing';
    return cell.status === 'ok' ? cell.outcome : cell.status;
  };

  const graded = {};
  for (const renderer of RENDERERS) {
    const pairs = [];
    let unsupported = 0;
    for (const [k, c] of truth) {
      if (c.answer === 'cantTell') continue;
      const actual = outcomeOf(renderer, k);
      if (actual === 'missing') problems.push(`${renderer}: no verdict for ${k}`);
      if (actual === 'unsupported') unsupported += 1;
      pairs.push({ truth: c.answer, actual });
    }
    graded[renderer] = { ...confusion(pairs), unsupported };
  }

  // The static run has to be the run the table published, rule by rule.
  for (const entry of table.realCorpus.entries.filter((e) => e.engine === 'marlo')) {
    const strict = entry.graded.strict;
    if (strict === null) continue;
    const pairs = [...truth]
      .filter(([k, c]) => k.endsWith(`/${entry.actRuleId}`) && c.answer !== 'cantTell')
      .map(([k, c]) => ({ truth: c.answer, actual: outcomeOf('static', k) }));
    const mine = confusion(pairs);
    for (const field of ['truePositives', 'falsePositives', 'falseNegatives']) {
      if (mine[field] !== strict[field]) {
        problems.push(
          `${entry.actRuleId}: ${field} is ${String(mine[field])} here and ` +
            `${String(strict[field])} in calibration/table.json; rescan with --scan`,
        );
      }
    }
  }

  const errors = [];
  for (const [k, c] of truth) {
    if (c.answer === 'cantTell') continue;
    const actual = outcomeOf('static', k);
    if (actual === 'unsupported' || actual === 'error' || actual === 'missing') continue;
    const expected = c.answer === 'failed';
    const reported = actual === 'failed';
    if (expected === reported) continue;
    const row = {
      kind: reported ? 'FP' : 'FN',
      page: c.page,
      rule: c.rule,
      truth: c.answer,
      actual,
      browser: outcomeOf('browser', k),
      truthSource: c.source,
    };
    const matched = causes.filter((cause) => cause.kind === row.kind && cause.match(row));
    if (matched.length !== 1) {
      problems.push(
        `${row.kind} ${k} (${actual}, truth ${c.answer}) matches ${String(matched.length)} causes` +
          (matched.length > 1 ? `: ${matched.map((m) => m.id).join(', ')}` : ''),
      );
      continue;
    }
    const cell = verdicts.static[k];
    errors.push({
      ...row,
      cause: matched[0].id,
      marlo: cell.evidence.slice(0, 2),
      raterA: noteA.get(k) ?? '',
      raterB: noteB.get(k) ?? '',
      resolution: reasoning.get(k) ?? null,
    });
  }
  errors.sort(
    (x, y) =>
      x.kind.localeCompare(y.kind) || x.rule.localeCompare(y.rule) || x.page.localeCompare(y.page),
  );

  // A rule the ACT suite passes perfectly can still be wrong here: the suite never tested it.
  const actPerfect = new Set(
    table.entries
      .filter((e) => e.engine === 'marlo' && e.strict !== null && e.strict !== undefined)
      .filter((e) => e.strict.falsePositives === 0 && e.strict.falseNegatives === 0)
      .map((e) => e.actRuleId),
  );

  const byCause = causes
    .map((cause) => {
      const cells = errors.filter((e) => e.cause === cause.id);
      const browserCorrects = cells.filter((e) =>
        e.kind === 'FP' ? e.browser !== 'failed' : e.browser === 'failed',
      ).length;
      const rules = [...new Set(cells.map((e) => e.rule))].sort();
      return {
        id: cause.id,
        family: cause.family,
        kind: cause.kind,
        title: cause.title,
        detail: cause.detail,
        cells: cells.length,
        pages: new Set(cells.map((e) => e.page)).size,
        rules,
        rulesPerfectOnAct: rules.filter((r) => actPerfect.has(r)),
        browserCorrects,
      };
    })
    .filter((c) => c.cells > 0)
    .sort((x, y) => x.kind.localeCompare(y.kind) || y.cells - x.cells);

  // Errors the browser run introduces that the static run did not make.
  const browserOnly = [];
  for (const [k, c] of truth) {
    if (c.answer === 'cantTell') continue;
    const s = outcomeOf('static', k);
    const b = outcomeOf('browser', k);
    const wrong = (a) => (a === 'failed') !== (c.answer === 'failed');
    if (wrong(b) && !wrong(s))
      browserOnly.push({ page: c.page, rule: c.rule, truth: c.answer, static: s, browser: b });
  }

  const unsupportedFailures = [...truth].filter(
    ([k, c]) => c.answer === 'failed' && outcomeOf('static', k) === 'unsupported',
  ).length;

  return {
    problems,
    report: {
      gradedCells: [...truth.values()].filter((c) => c.answer !== 'cantTell').length,
      graded,
      falsePositives: errors.filter((e) => e.kind === 'FP').length,
      falseNegatives: errors.filter((e) => e.kind === 'FN').length,
      unsupportedFailures,
      byCause,
      browserOnly,
      errors,
    },
  };
}

const pct = (x) =>
  x?.value === null || x?.value === undefined ? 'n/a' : `${(x.value * 100).toFixed(1)}%`;
const dec = (x) => (x?.value === null || x?.value === undefined ? 'n/a' : x.value.toFixed(3));
const ci = (x) =>
  x?.interval ? ` (${dec({ value: x.interval.low })} to ${dec({ value: x.interval.high })})` : '';
const cellText = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
const clip = (s, n) => {
  const t = cellText(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function renderMarkdown(report) {
  const g = report.graded;
  const families = {};
  for (const c of report.byCause) {
    families[c.family] ??= { FP: 0, FN: 0 };
    families[c.family][c.kind] += c.cells;
  }
  const fpRenderer = report.byCause
    .filter((c) => c.kind === 'FP' && c.family === 'renderer')
    .reduce((s, c) => s + c.cells, 0);
  const fpBrowser = report.byCause
    .filter((c) => c.kind === 'FP')
    .reduce((s, c) => s + c.browserCorrects, 0);
  const suiteBlind = report.byCause.flatMap((c) => c.rulesPerfectOnAct);
  const row = (label, x) =>
    `| ${label} | ${String(x.truePositives)} | ${String(x.falsePositives)} | ${String(x.falseNegatives)} | ` +
    `${String(x.unsupported)} | ${dec(x.precision)}${ci(x.precision)} | ${dec(x.recall)}${ci(x.recall)} | ` +
    `${pct(x.falsePositiveRate)} |`;

  const lines = [
    "# Why Marlo's engine is wrong on real pages",
    '',
    'Generated by `node scripts/error-analysis.mjs` from `real-marlo-verdicts.json` and the ' +
      'resolved cells in `corpus/real/adjudication/`. Do not edit.',
    '',
    `On the ${String(report.gradedCells)} resolved real-page cells, Marlo's own engine reports ` +
      `${String(report.falsePositives)} false positives and ${String(report.falseNegatives)} false ` +
      `negatives among the rules it evaluates. A further ${String(report.unsupportedFailures)} ` +
      'failures fall on rules it cannot evaluate without layout, and count against its recall in ' +
      'the calibration table. Every wrong cell is listed below with what Marlo said, what both ' +
      'raters said, and a root cause. The ground truth is model-adjudicated; see ' +
      '`corpus/real/adjudication/RATER-VALIDITY.md` for how accurate that process is.',
    '',
    '## Findings',
    '',
    `1. **Rule logic, not the renderer, causes most false positives.** ` +
      `${String(families['rule logic']?.FP ?? 0)} of ${String(report.falsePositives)} come from rule logic that ` +
      `contradicts the ACT rule text. ${String(fpRenderer)} come from the static renderer, which does ` +
      'no layout and so cannot see that a stylesheet hides an element.',
    `2. **One defect causes ${String(report.byCause.find((c) => c.id === 'idref-exception')?.cells ?? 0)} false positives.** ` +
      'Marlo fails an ID reference whose target is missing, which the rule explicitly allows.',
    `3. **Most false negatives are abstentions.** ` +
      `${String(families.abstention?.FN ?? 0)} of ${String(report.falseNegatives)} are cells where Marlo answered ` +
      'cantTell, mostly because a bypass rule depends on what repeats across pages, or because ' +
      'whether an image is decorative is a judgment. Strict grading counts an abstention on a ' +
      'failure as a miss.',
    `4. **The ACT suite does not catch these.** ${String(new Set(suiteBlind).size)} rules with real-page ` +
      `errors (${[...new Set(suiteBlind)].sort().join(', ')}) score perfectly on their ACT test cases, ` +
      'because no test case exercises the construct that fails here.',
    `5. **A browser renderer would change the picture.** Rerun in headless Chromium, Marlo's ` +
      `precision is ${dec(g.browser.precision)} against ${dec(g.static.precision)}, and its recall ` +
      `${dec(g.browser.recall)} against ${dec(g.static.recall)}. Most of the recall comes from rules ` +
      `that need layout. Chromium removes ${String(fpBrowser)} of the ${String(report.falsePositives)} false positives ` +
      `and introduces ${String(report.browserOnly.length)} new errors. This compares Marlo with itself; ` +
      'the comparison between engines in the calibration table uses the static renderer for all four.',
    '',
    "## Marlo's engine on the resolved cells, by renderer",
    '',
    '| Renderer | True positives | False positives | False negatives | Unsupported | Precision (95% CI) | Recall (95% CI) | False positive rate |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    row('Static (published)', g.static),
    row('Headless Chromium', g.browser),
    '',
    'Grading is strict, as in the calibration table: a cantTell on a failed cell is a false ' +
      'negative, and an unsupported rule reports nothing. The static row reproduces the ' +
      "table's real-page figures for Marlo exactly, and `--check` fails if it stops doing so.",
    '',
    '## Root causes',
    '',
    '| Kind | Cause | Family | Cells | Pages | Rules | Perfect on ACT | Chromium corrects |',
    '| --- | --- | --- | ---: | ---: | --- | --- | ---: |',
    ...report.byCause.map(
      (c) =>
        `| ${c.kind === 'FP' ? 'False positive' : 'False negative'} | ${c.title} | ${c.family} | ` +
        `${String(c.cells)} | ${String(c.pages)} | ${c.rules.join(', ')} | ` +
        `${c.rulesPerfectOnAct.length > 0 ? c.rulesPerfectOnAct.join(', ') : 'none'} | ${String(c.browserCorrects)} |`,
    ),
    '',
    '"Perfect on ACT" lists the rules among them that Marlo gets entirely right on the ACT ' +
      'test cases. "Chromium corrects" counts the cells the browser renderer gets right.',
    '',
    ...report.byCause.flatMap((c) => [`### ${c.title}`, '', c.detail, '']),
    '## Every wrong cell',
    '',
    '| Kind | Rule | Page | Truth | Marlo | Chromium | Cause | Marlo said | Rater A | Rater B |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.errors.map(
      (e) =>
        `| ${e.kind} | ${e.rule} | ${e.page} | ${e.truth}${e.truthSource === 'resolution' ? ' (resolved)' : ''} | ` +
        `${e.actual} | ${e.browser} | ${e.cause} | ${clip(e.marlo[0]?.message ?? '', 160)} | ` +
        `${clip(e.raterA, 200)} | ${clip(e.raterB, 200)} |`,
    ),
    '',
    'A truth marked "(resolved)" is one the raters disagreed on and the resolver decided; its ' +
      'reasoning is in `corpus/real/adjudication/DISAGREEMENTS.md`.',
    '',
    '## Errors only the browser run makes',
    '',
    ...(report.browserOnly.length === 0
      ? ['None.']
      : [
          '| Rule | Page | Truth | Static | Chromium |',
          '| --- | --- | --- | --- | --- |',
          ...report.browserOnly.map(
            (b) => `| ${b.rule} | ${b.page} | ${b.truth} | ${b.static} | ${b.browser} |`,
          ),
        ]),
    '',
    '## What this does not do',
    '',
    'None of these defects is fixed here. Fixing a rule because it was wrong on these pages ' +
      'would turn the real-page corpus into training data, and the published real-page figures ' +
      'would stop being a held-out measurement. A fix belongs with new pages to measure it on.',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * One rule on one page, reduced to what the report reads: the collapsed outcome, how many
 * elements it judged, and the first few verdicts behind that outcome. Keeping every verdict
 * would commit some 18 MB, mostly passes on large pages.
 */
export function summarise(result) {
  if (result.status !== 'ok') {
    return { status: result.status, outcome: null, elements: 0, evidence: [] };
  }
  const outcome = collapse(result.verdicts);
  return {
    status: 'ok',
    outcome,
    elements: result.verdicts.length,
    evidence: result.verdicts
      .filter((v) => v.outcome === outcome)
      .slice(0, 3)
      .map((v) => ({ selector: v.target?.selector ?? v.selector, message: v.message })),
  };
}

/** Runs Marlo on every real page, once per renderer, keeping what the report needs. */
async function scan() {
  const [{ MarloEngine, loadRealCorpus }, { StaticRenderer, BrowserRenderer }] = await Promise.all([
    import('@trymarlo/calibrate'),
    import('@trymarlo/render'),
  ]);
  const corpus = loadRealCorpus(ROOT);
  const resolved = JSON.parse(readFileSync(join(ADJ, 'resolved.json'), 'utf8'));
  const rules = [...new Set(resolved.cells.map((c) => c.rule))].sort();
  const engine = new MarloEngine();
  const out = {};
  for (const [name, Renderer] of [
    ['static', StaticRenderer],
    ['browser', BrowserRenderer],
  ]) {
    const renderer = new Renderer();
    out[name] = {};
    try {
      for (const page of corpus.pages) {
        const rendered = await renderer.render({ html: corpus.read(page), url: page.url });
        try {
          const report = await engine.evaluate(rendered, rules);
          for (const rule of rules) {
            const result = report.results.find((r) => r.actRuleId === rule);
            out[name][key(page.id, rule)] =
              result === undefined
                ? { status: 'error', outcome: null, elements: 0, evidence: [] }
                : summarise(result);
          }
        } finally {
          await rendered.close();
        }
        console.error(`scan: ${name} ${page.id}`);
      }
    } finally {
      await renderer.dispose();
    }
  }
  const sorted = Object.fromEntries(
    Object.entries(out).map(([r, cells]) => [
      r,
      Object.fromEntries(Object.entries(cells).sort(([a], [b]) => a.localeCompare(b))),
    ]),
  );
  // Messages quote page text, em dashes included. Written as JSON escapes, the file holds
  // the same strings and stays inside the repository's prose rules without an exemption.
  const text = JSON.stringify(sorted, null, 1).replaceAll('\u2014', '\\u2014');
  writeFileSync(VERDICTS, `${text}\n`, 'utf8');
}

async function main(argv) {
  const check = argv.includes('--check');
  if (argv.includes('--scan')) await scan();
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
  if (!existsSync(VERDICTS)) {
    console.error('error-analysis: no calibration/real-marlo-verdicts.json; run with --scan.');
    process.exitCode = 1;
    return;
  }
  const { problems, report } = buildReport({
    verdicts: read(VERDICTS),
    resolved: read(join(ADJ, 'resolved.json')),
    sheets: { A: read(join(ADJ, 'sheet-A.json')), B: read(join(ADJ, 'sheet-B.json')) },
    resolutions: read(join(ADJ, 'resolutions.json')),
    table: read(join(ROOT, 'calibration', 'table.json')),
  });
  if (problems.length > 0) {
    for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
    console.error(`error-analysis: ${String(problems.length)} problem(s), nothing written.`);
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
        `error-analysis --check: ${stale.map(([f]) => f.replace(`${ROOT}/`, '')).join(', ')} ` +
          'would change. Run `node scripts/error-analysis.mjs` and commit the result.',
      );
      process.exitCode = 1;
      return;
    }
    console.log('error-analysis --check: up to date.');
    return;
  }
  writeFileSync(OUT_JSON, json, 'utf8');
  writeFileSync(OUT_MD, md, 'utf8');
  console.log(
    `error-analysis: ${String(report.falsePositives)} false positives and ` +
      `${String(report.falseNegatives)} false negatives, ${String(report.byCause.length)} causes.`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
