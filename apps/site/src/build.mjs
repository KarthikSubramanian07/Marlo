#!/usr/bin/env node
/**
 * Generates trymarlo.pages.dev into apps/site/dist.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * Every number on the site comes out of calibration/table.json. Not one is typed into a
 * template.
 *
 * That is not tidiness. The sibling PDF project's third defect was a web page with a
 * hard-coded scorecard reading one hundred percent, a progress indicator advancing on
 * setTimeout, and a real audit result that came back from the API and was never read. It now
 * carries two tests that exist only because of that: no setTimeout in the script, and no
 * static tick in the markup.
 *
 * Marlo's site displays accuracy numbers, so the failure mode is identical and the tests are
 * copied. A third is added: num() is the only way a numeral reaches the page, and
 * no-theatre.test.ts asserts every numeral in the rendered HTML can be traced to a field in
 * the table. A site about verifiable accuracy that typed its accuracy into HTML would be the
 * joke the whole project is about.
 *
 * The terminal block looks like an exception and is not. That text is read from
 * apps/site/src/recorded-scan.txt, an excerpt of a real run against apps/demo, and the site
 * test asserts every line of it appears verbatim in tests/golden/checkout-terminal.txt. Its
 * numbers are permitted because they were recorded, not because they looked plausible.
 *
 * No framework and no client script. Five pages and a build script. The interactive parts,
 * meaning the rule filter and the scroll reveals, are CSS.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..', '..');
const OUT = resolve(HERE, '..', 'dist');
const ORIGIN = 'https://trymarlo.pages.dev';
const REPO = 'https://github.com/KarthikSubramanian07/Marlo';

const table = JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8'));
const recorded = readFileSync(resolve(HERE, 'recorded-scan.txt'), 'utf8').trimEnd();

/* ── Numbers ─────────────────────────────────────────────────────────────────── */

/**
 * The only way a numeral reaches the page.
 *
 * Every call names the field it came from. no-theatre.test.ts collects those names and fails
 * if a numeral appears in the HTML that no call produced.
 */
function num(value, { as = 'plain', field } = {}) {
  if (field === undefined) throw new Error('num() needs the field it came from');
  if (value === null || value === undefined) return 'not measured';
  if (as === 'percent') return `${(value * 100).toFixed(1)}%`;
  if (as === 'rate') return value.toFixed(3);
  return String(value);
}

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** Pooled confusion counts for one engine, across every rule it maps. */
function engineTotals(engineId) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let ctF = 0;
  let ctP = 0;
  let rules = 0;
  for (const entry of table.entries) {
    if (entry.engine !== engineId || entry.mappingKind === 'none') continue;
    rules += 1;
    tp += entry.strict.truePositives;
    fp += entry.strict.falsePositives;
    fn += entry.strict.falseNegatives;
    tn += entry.strict.trueNegatives;
    ctF += entry.strict.cantTellOnFailed;
    ctP += entry.strict.cantTellOnPassed;
  }
  const ratio = (a, b) => (b === 0 ? null : a / b);
  return {
    rules,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn),
    cantTellOnFailed: ctF,
    cantTellOnPassed: ctP,
    sampleSize: tp + fp + fn + tn,
  };
}

/** Rule names, read from the vendored corpus rather than restated here. */
const RULE_NAMES = {};
for (const rule of JSON.parse(readFileSync(resolve(ROOT, 'corpus/act/MANIFEST.json'), 'utf8'))
  .rules) {
  RULE_NAMES[rule.id] = rule.name;
}

const ENGINE_LABEL = {
  marlo: 'Marlo',
  'axe-core': 'axe-core',
  alfa: 'Alfa',
  htmlcs: 'HTML CodeSniffer',
};

const engines = ['alfa', 'axe-core', 'marlo', 'htmlcs'].map((id) => ({
  id,
  label: ENGINE_LABEL[id],
  ...engineTotals(id),
}));

const marlo = engines.find((e) => e.id === 'marlo');
const best = [...engines]
  .filter((e) => e.precision !== null)
  .sort((a, b) => b.precision - a.precision)[0];
const flattered = table.entries.filter((e) => e.flatteredByProtocol);
const routedTo = (id) => table.routing.filter((r) => r.chosen === id).length;
const autoFixable = table.routing.filter((r) => r.autoFixPermitted).length;
const routedTotal = table.routing.filter((r) => r.chosen !== null).length;

/**
 * The rank beside each engine, written as a word so it never depends on colour.
 *
 * An engine that never reports a failure has a false positive rate of zero, and the first
 * version of this ranked it first and printed "best" next to HTML CodeSniffer. Which is the
 * precise fallacy this whole site is arguing against: a tool that says nothing cannot be
 * wrong, and that is not the same as being right.
 *
 * So an engine only enters the ranking if it detects something. The others are labelled with
 * what they actually did.
 */
const ranked = [...engines]
  .filter((e) => e.falsePositiveRate !== null && (e.recall ?? 0) > 0)
  .sort((a, b) => a.falsePositiveRate - b.falsePositiveRate)
  .map((e) => e.id);

function rankMark(engineId) {
  const engine = engines.find((e) => e.id === engineId);
  if (engine !== undefined && (engine.recall ?? 0) === 0) {
    return `<span class="rank rank--bad">no detections</span>`;
  }
  const place = ranked.indexOf(engineId);
  if (place === -1) return '';
  const words = ['best', '2nd', '3rd', '4th'];
  const tone = place === 0 ? 'ok' : place === ranked.length - 1 ? 'bad' : 'warn';
  return `<span class="rank rank--${tone}">${words[place] ?? ''}</span>`;
}

/* ── Icons ───────────────────────────────────────────────────────────────────── */

/*
 * Every icon carries width and height attributes, not just a viewBox.
 *
 * Without them the GitHub glyph inherited its size from its container, and inside a
 * full-width button on a phone it grew to 350 pixels across with the label pushed off to one
 * side. `img, svg { max-width: 100% }` in the reset caps the damage at the container width and
 * does nothing to prevent it. Intrinsic dimensions are the fix; the CSS below is a second belt.
 */
const ICON = {
  // Square in a square. Two nested rectangles, no rounding, no gradient: a finding inside a
  // page, or an aperture, depending on how long you look at it. It reads at 16 pixels, which
  // is the only test a mark has to pass.
  mark: `<svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3" y="3" width="26" height="26" fill="currentColor"/><rect x="12" y="12" width="8" height="8" fill="#09090b"/></svg>`,
  github: `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.9-1.18-.9-1.18-.73-.5.06-.49.06-.49.81.06 1.24.83 1.24.83.72 1.23 1.88.88 2.34.67.07-.52.28-.88.51-1.08-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.14.46.55.38A7.99 7.99 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
  arrow: `<svg class="arrow" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9 9 3M4.6 3H9v4.4"/></svg>`,
};

/* ── Layout ──────────────────────────────────────────────────────────────────── */

const NAV = [
  ['/', 'index', 'Overview'],
  ['/accuracy/', 'accuracy', 'The numbers'],
  ['/rules/', 'rules', 'Rules'],
  ['/method/', 'method', 'Method'],
  ['/honesty/', 'honesty', 'Honesty'],
];

function layout({ slug, title, description, body, canonical }) {
  const nav = NAV.map(
    ([href, id, label]) =>
      `<a href="${href}"${id === slug ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('\n          ');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Marlo',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Node.js 22.13 and later',
    url: ORIGIN,
    license: 'https://opensource.org/licenses/MIT',
    codeRepository: REPO,
    description:
      `Finds accessibility violations and publishes its own error rate. Covers ` +
      `${num(table.coverage.implemented, { field: 'coverage.implemented' })} of ` +
      `${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })} published ACT rules.`,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="preload" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/style.css" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#09090b" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Marlo" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${ORIGIN}/og.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${ORIGIN}/og.svg" />

    <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 6)}
    </script>
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>

    <header class="masthead">
      <div class="wrap masthead__inner">
        <a class="wordmark" href="/">${ICON.mark}marlo</a>
        <nav class="nav" aria-label="Primary">
          <div class="nav__scroll">
          ${nav}
          </div>
        </nav>
        <a class="masthead__source" href="${REPO}">${ICON.github}Source</a>
      </div>
    </header>

    <main id="main">
${body}
    </main>

    <footer class="foot">
      <div class="wrap">
        <div class="foot__grid">
          <div>
            <h2>Marlo</h2>
            <ul>
              <li><a href="${REPO}">Source on GitHub</a></li>
              <li><a href="/accuracy/">The numbers</a></li>
              <li><a href="/rules/">Rules covered</a></li>
            </ul>
          </div>
          <div>
            <h2>The argument</h2>
            <ul>
              <li><a href="${REPO}/blob/main/RESEARCH.md">What was measured first</a></li>
              <li><a href="${REPO}/blob/main/DECISIONS.md">Twelve decisions</a></li>
              <li><a href="/honesty/">Where Marlo was wrong</a></li>
            </ul>
          </div>
          <div>
            <h2>Standards</h2>
            <ul>
              <li><a href="https://www.w3.org/TR/act-rules-format/">ACT Rules Format 1.1</a></li>
              <li><a href="https://act-rules.github.io">The ACT rule corpus</a></li>
              <li><a href="https://www.w3.org/TR/WCAG22/">WCAG 2.2</a></li>
            </ul>
          </div>
          <div>
            <h2>Tell us we are wrong</h2>
            <ul>
              <li><a href="${REPO}/issues/new?template=false-positive.yml">Report a false positive</a></li>
              <li><a href="${REPO}/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Anew-rule">Implement a rule</a></li>
              <li><a href="${REPO}/issues/new?template=calibration-dispute.yml">Dispute a number</a></li>
            </ul>
          </div>
        </div>
        <div class="foot__legal">
          <p>
            Automated analysis and verified repair. Not legal certification, because no tool
            can issue that. Coverage is
            ${num(table.coverage.implemented, { field: 'coverage.implemented' })} of
            ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })}
            published ACT rules. Every figure here is generated from
            <a href="${REPO}/blob/main/calibration/table.json">calibration/table.json</a>,
            measured ${escapeHtml(table.generated)}, corpus retrieved
            ${escapeHtml(table.corpus.retrieved)}. MIT licensed.
          </p>
        </div>
      </div>
    </footer>
  </body>
</html>
`;
}

/* ── Shared fragments ────────────────────────────────────────────────────────── */

function scoreboard({ wide = false } = {}) {
  return `<div class="scoreboard${wide ? ' scoreboard--4' : ''}">
${engines
  .map(
    (e) => `              <div class="score${e.id === 'marlo' ? ' score--marlo' : ''}">
                <span class="score__engine">${escapeHtml(e.label)}${rankMark(e.id)}</span>
                <span class="score__value">${num(e.falsePositiveRate, { as: 'percent', field: `strict.falsePositiveRate.${e.id}` })}</span>
                <span class="score__unit">false positives</span>
              </div>`,
  )
  .join('\n')}
            </div>`;
}

function engineTable() {
  return `<div class="scroller" role="region" aria-label="Accuracy per engine, scrollable" tabindex="0">
            <table>
              <caption>
                ${num(marlo.sampleSize, { field: 'aggregate.sampleSize' })} official test case
                outcomes, strict view, where cantTell counts as no detection.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Engine</th>
                  <th scope="col">Rules</th>
                  <th scope="col">Precision</th>
                  <th scope="col">Recall</th>
                  <th scope="col">False positives</th>
                  <th scope="col">cantTell, miss / cautious</th>
                </tr>
              </thead>
              <tbody>
${engines
  .map(
    (e) => `                <tr${e.id === 'marlo' ? ' class="is-marlo"' : ''}>
                  <th scope="row">${escapeHtml(e.label)}</th>
                  <td class="num">${num(e.rules, { field: `entries.count.${e.id}` })}</td>
                  <td class="num">${num(e.precision, { as: 'rate', field: `strict.precision.${e.id}` })}</td>
                  <td class="num">${num(e.recall, { as: 'rate', field: `strict.recall.${e.id}` })}</td>
                  <td class="num">${num(e.falsePositiveRate, { as: 'percent', field: `strict.falsePositiveRate.${e.id}` })}</td>
                  <td class="num">${num(e.cantTellOnFailed, { field: `strict.cantTellOnFailed.${e.id}` })} / ${num(e.cantTellOnPassed, { field: `strict.cantTellOnPassed.${e.id}` })}</td>
                </tr>`,
  )
  .join('\n')}
              </tbody>
            </table>
          </div>`;
}

/**
 * The recorded terminal. Real stdout, and every line of it is asserted verbatim against the
 * committed golden file by the site test.
 *
 * The colouring is applied here rather than captured, because ANSI escape codes in HTML would
 * be a different kind of lie. The text is untouched.
 */
function terminal() {
  const coloured = escapeHtml(recorded)
    .replace(/^\$ (.*)$/m, '<span class="t-prompt">$</span> $1')
    .replace(/NOT EXAMINED/g, '<span class="t-warn">NOT EXAMINED</span>')
    .replace(/INVARIANT/g, '<span class="t-warn">INVARIANT</span>')
    .replace(/▲▲▲ critical/g, '<span class="t-crit">▲▲▲ critical</span>')
    .replace(/▲ {3}moderate/g, '<span class="t-warn">▲   moderate</span>')
    .replace(
      /^( +)(WCAG .*|disagreement:.*|09o5cg afw4f7|This is not a pass.*|-{20,}|static renderer.*|one-directional.*)$/gm,
      '$1<span class="t-dim">$2</span>',
    )
    .replace(/^(\s+)(input\[[^\n]*|div\[[^\n]*)$/gm, '$1<span class="t-sel">$2</span>');

  return `<div class="terminal">
            <div class="terminal__bar" aria-hidden="true">
              <span class="terminal__dot"></span>
              <span class="terminal__dot"></span>
              <span class="terminal__dot"></span>
              <span class="terminal__title">marlo scan</span>
            </div>
            <div class="terminal__body" role="region" aria-label="Recorded terminal output, scrollable" tabindex="0">
<pre>${coloured}<span class="caret" aria-hidden="true"></span></pre>
            </div>
          </div>`;
}

/* ── Pages ───────────────────────────────────────────────────────────────────── */

const pages = [];

pages.push({
  slug: 'index',
  path: 'index.html',
  title: 'Marlo: an accessibility checker that publishes its own error rate',
  description:
    `Marlo checks pages against the official ACT corpus, sends each rule to whichever engine ` +
    `measures best at it, and publishes what it gets wrong. Its own false positive rate is ` +
    `${num(marlo.falsePositiveRate, { as: 'percent', field: 'strict.falsePositiveRate.marlo' })}. ` +
    `${num(table.coverage.implemented, { field: 'coverage.implemented' })} of ` +
    `${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })} published ACT rules.`,
  body: `      <section class="hero hero--centred">
        <div class="hero__grid" aria-hidden="true"></div>
        <div class="wrap hero__inner">
          <span class="eyebrow eyebrow--accent">Measured over ${num(table.corpus.testCases, { field: 'corpus.testCases' })} official W3C test cases</span>
          <h1>Every accessibility tool says it is accurate. Here is our receipt.</h1>
          <p class="lede">
            Marlo checks your pages against the official ACT rule corpus. Then it turns the
            same corpus on itself and commits the score, including the part where it loses.
          </p>
          <div class="hero__actions">
            <a class="btn btn-primary" href="/accuracy/">See the numbers${ICON.arrow}</a>
            <a class="btn btn-ghost" href="${REPO}">${ICON.github}Read the source</a>
          </div>
          <div class="hero__preview">
            <div class="hero__preview-tilt">
              ${terminal()}
            </div>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap">
          <div class="split split--wide">
            <div class="headline-stat">
              <span class="eyebrow">Our false positive rate</span>
              <span class="headline-stat__value">${num(marlo.falsePositiveRate, { as: 'percent', field: 'strict.falsePositiveRate.marlo' })}</span>
              <span class="headline-stat__label">
                ${num(Math.round((marlo.falsePositiveRate / best.falsePositiveRate) * 10) / 10, { field: 'derived.marloVsBest' })}
                times worse than ${escapeHtml(best.label)}. No vendor prints this, which is
                exactly why it goes near the top.
              </span>
              <a class="textlink" href="/accuracy/" style="margin-top: 14px">
                The whole table, per rule${ICON.arrow}
              </a>
            </div>
            ${scoreboard({ wide: false })}
          </div>
          <div class="grid grid--2" style="margin-top: 20px">
            <div class="tile tile--pad">
              <span class="eyebrow">Above the findings, not in a footnote</span>
              <p class="row__body" style="margin-top: 10px">
                In the output above, two rules need CSS layout. That renderer has none, so it
                says so first, before anything it did find. "No contrast problems found" and
                "contrast not examined" are different sentences and Marlo will not blur them.
              </p>
            </div>
            <div class="tile tile--pad">
              <span class="eyebrow">A disagreement, on the record</span>
              <p class="row__body" style="margin-top: 10px">
                The router sends that ARIA rule to axe-core. Marlo's own rule said it could
                not tell. axe-core said failed, so the failure goes through and the dissent
                gets printed underneath it.
              </p>
            </div>
          </div>
          <p class="dim" style="margin-top: 28px">
            That is real stdout from <code>marlo scan</code> over the deliberately broken
            pages in <code>apps/demo</code>. Trimmed for length, not edited: the test suite
            checks every line of it against the committed golden file.
          </p>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap">
          <div class="split">
            <div>
              <div class="section-head">
                <span class="eyebrow">The problem</span>
                <h2>Detection is not the hard part. Nobody publishing an error rate is.</h2>
              </div>
              <div class="prose stack">
                <p>
                  Lighthouse hands out 100s to pages a screen reader cannot get through. A
                  large AI site builder shipped an unusable product while its own bundled
                  checker reported perfection. The best funded vendor in this category
                  advertises "19x more critical issues" and has never said more than what, or
                  how it counted.
                </p>
                <p>
                  None of that is a detection failure. It is a market where
                  <strong>a claim nobody can check is free to make.</strong>
                </p>
                <p>
                  So Marlo does the tedious version instead. Four engines, every official W3C
                  test case, precision and recall per rule per engine, table committed to the
                  repository, regenerated on every push. When a number gets worse the build
                  goes red and the changelog says which one.
                </p>
                <p>
                  An improvement fails the build too, if nobody committed the new table. A
                  figure that quietly got better is a figure the README is now wrong about.
                </p>
              </div>
            </div>
            <div class="grid">
              <div class="aside-figure">
                <span class="eyebrow">Official test cases, vendored and hashed</span>
                <span class="aside-figure__value">${num(table.corpus.testCases, { field: 'corpus.testCases' })}</span>
                <span class="aside-figure__label">
                  Across
                  ${num(table.corpus.rulesWithTestCases, { field: 'corpus.rulesWithTestCases' })}
                  rules that publish them, with a SHA-256 per file.
                </span>
                <span class="aside-figure__note">
                  <code>pnpm corpus:verify</code> fails on a changed byte. If a test case could
                  be edited, an inconvenient result could be fixed by changing the question
                  instead of the answer.
                </span>
              </div>
              <div class="aside-figure">
                <span class="eyebrow">Engine and rule pairs measured</span>
                <span class="aside-figure__value">${num(table.entries.length, { field: 'entries.length' })}</span>
                <span class="aside-figure__label">
                  Every engine against every rule it maps, through one code path.
                </span>
                <span class="aside-figure__note">
                  Regenerated by <code>pnpm calibrate</code> in CI. Both a regression and an
                  uncommitted improvement fail the build.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">How it works</span>
            <h2>Six stages, and stage five can override the other five</h2>
            <p>
              Marlo routes. It does not pile four engines' output into one list and call the
              pile thorough. Each rule is reported by whichever engine measured best at that
              rule, and one stage is allowed to overrule the routing.
            </p>
          </div>
          <ol class="pipeline">
            <li class="stage">
              <span class="stage__index" aria-hidden="true">1</span>
              <div>
                <span class="stage__name">Render</span>
                <p class="stage__detail">
                  A Node DOM by default: no browser, no network, milliseconds. Playwright if
                  you want layout, and it is opt-in rather than assumed.
                </p>
                <span class="stage__tag">happy-dom, or chromium</span>
              </div>
            </li>
            <li class="link-mark" aria-hidden="true"></li>
            <li class="stage">
              <span class="stage__index" aria-hidden="true">2</span>
              <div>
                <span class="stage__name">Run four engines</span>
                <p class="stage__detail">
                  axe-core, Alfa, HTML CodeSniffer, and Marlo's own
                  ${num(table.coverage.implemented, { field: 'coverage.implemented' })} rules.
                  All in-process. None of them can see the others, and that isolation is a
                  dependency rule rather than a habit.
                </p>
                <span class="stage__tag">nobody gets a longer timeout</span>
              </div>
            </li>
            <li class="link-mark" aria-hidden="true"></li>
            <li class="stage">
              <span class="stage__index" aria-hidden="true">3</span>
              <div>
                <span class="stage__name">Normalise to ACT identifiers</span>
                <p class="stage__detail">
                  Four vocabularies collapse into one. The axe-core mapping was derived by
                  measurement over the corpus. The other two are documentation matches, and
                  every entry in both says so.
                </p>
                <span class="stage__tag">partial mappings are labelled partial</span>
              </div>
            </li>
            <li class="link-mark" aria-hidden="true"></li>
            <li class="stage">
              <span class="stage__index" aria-hidden="true">4</span>
              <div>
                <span class="stage__name">Route from the table</span>
                <p class="stage__detail">
                  Whichever engine measured best on a rule reports that rule.
                  ${num(routedTo('axe-core'), { field: 'routing.axe-core' })} go to axe-core,
                  ${num(routedTo('marlo'), { field: 'routing.marlo' })} to Marlo,
                  ${num(routedTo('alfa'), { field: 'routing.alfa' })} to Alfa, and
                  ${num(table.routing.filter((r) => r.chosen === null).length, { field: 'routing.none' })}
                  to nobody at all.
                </p>
                <span class="stage__tag">one finding, provenance attached</span>
              </div>
            </li>
            <li class="link-mark" aria-hidden="true"></li>
            <li class="stage stage--gate">
              <span class="stage__index" aria-hidden="true">5</span>
              <div>
                <span class="stage__name">Apply the one-directional invariant</span>
                <p class="stage__detail">
                  Routing picks who speaks. It cannot silence anyone. If <em>any</em> engine
                  reports a failure, Marlo may not report clean. It is allowed to dissent,
                  named, on the record.
                </p>
                <span class="stage__tag">tested over all 256 outcome combinations</span>
              </div>
            </li>
            <li class="link-mark" aria-hidden="true"></li>
            <li class="stage">
              <span class="stage__index" aria-hidden="true">6</span>
              <div>
                <span class="stage__name">Report</span>
                <p class="stage__detail">
                  Terminal, JSON, SARIF 2.1.0, or a pull request body. Every surface puts what
                  was not examined above what was found.
                </p>
                <span class="stage__tag">severity is a text mark first</span>
              </div>
            </li>
          </ol>
          <div class="callout" style="margin-top: 24px">
            <span class="callout__mark" aria-hidden="true">i</span>
            <p>
              Why routing and not a union: engines find largely <em>disjoint</em> issue sets
              and agree poorly, so unioning them lifts recall and buries the signal. One
              project integrated ten engines and about a thousand rules, got published at
              SIGACCESS, got adopted inside a Fortune 50 company, and reached almost nobody.
              Hand somebody ten engines' output and you have turned their detection problem
              into a triage problem, which is worse.
            </p>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">Where it will not help</span>
            <h2>The list a sales page would leave out</h2>
          </div>
          <div class="rowset rowset--2">
            <div class="row">
              <span class="row__title"><span class="bullet" aria-hidden="true">1</span>It is not comprehensive</span>
              <p class="row__body">
                ${num(table.coverage.implemented, { field: 'coverage.implemented' })} of
                ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })}
                published ACT rules, and automation reaches a minority of WCAG no matter who
                writes it. The denominator is on every page here for that reason.
              </p>
            </div>
            <div class="row">
              <span class="row__title"><span class="bullet" aria-hidden="true">2</span>It will not recolour your design</span>
              <p class="row__body">
                Contrast gets detected and located. Never changed. Picking a colour is a
                design decision and it stays yours.
              </p>
            </div>
            <div class="row">
              <span class="row__title"><span class="bullet" aria-hidden="true">3</span>It will not invent alt text</span>
              <p class="row__body">
                Decorative images get an empty alt, confidently. A description gets written
                only where the page already contains the meaning. The rest comes back to you,
                because a confident wrong description is worse than a missing one. You can
                spot a gap.
              </p>
            </div>
            <div class="row">
              <span class="row__title"><span class="bullet" aria-hidden="true">4</span>It cannot certify anything</span>
              <p class="row__body">
                Neither can anybody else. What you get is verified repair against named
                success criteria, plus an error rate you can look up. That is the whole offer.
              </p>
            </div>
            <div class="row">
              <span class="row__title"><span class="bullet" aria-hidden="true">5</span>Repair is not merged yet</span>
              <p class="row__body">
                Detection, routing, calibration and reporting are.
                <code>marlo fix</code> exits with an error saying that the repair layer is not merged,
                instead of being a flag that quietly does nothing.
              </p>
            </div>
            <div class="row">
              <span class="row__title"><span class="bullet" aria-hidden="true">6</span>Two of three mappings are unverified</span>
              <p class="row__body">
                Only the axe-core mapping was derived by measurement. Alfa's and HTML
                CodeSniffer's are documentation matches, marked partial, and a test fails if
                either one ever claims otherwise.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap">
          <div class="split">
            <div>
              <div class="section-head">
                <span class="eyebrow">The part that is not negotiable</span>
                <h2>Marlo will never sell remediation to anyone it rates.</h2>
              </div>
              <div class="prose stack">
                <p>
                  Every incumbent that both scores you and fixes you has a reason to find work
                  it can bill for. That is not a conspiracy, it is an incentive, and
                  incentives win.
                </p>
                <p>
                  Independence is the only asset a measuring tool owns. Spend it and you do
                  not get it back.
                </p>
              </div>
            </div>
            <div class="tile tile--pad tile--glow">
              <span class="eyebrow">Also never</span>
              <ul class="checklist" style="margin-top: 22px">
                <li><span class="bullet" aria-hidden="true">x</span>Merge its own pull requests</li>
                <li><span class="bullet" aria-hidden="true">x</span>Push to your default branch</li>
                <li><span class="bullet" aria-hidden="true">x</span>Force push, or rewrite history</li>
                <li><span class="bullet" aria-hidden="true">x</span>Deploy anything, anywhere</li>
              </ul>
              <p class="dim" style="margin-top: 16px">
                Enforced in the token scopes it asks for and asserted by tests, not promised in
                prose.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="cta">
        <div class="wrap cta__inner">
          <h2>Running it takes about five minutes.</h2>
          <p>
            No API key, no browser download, no account, and no network after install. If any
            of that turns out to be false, it is a bug and we want the issue.
          </p>
          <div class="hero__actions">
            <a class="btn btn-primary" href="${REPO}">${ICON.github}Clone the repository</a>
            <a class="btn btn-ghost" href="/honesty/">Read where it was wrong${ICON.arrow}</a>
          </div>
        </div>
      </section>`,
});

pages.push({
  slug: 'accuracy',
  path: 'accuracy/index.html',
  title: 'The numbers: four engines measured against the official ACT corpus',
  description:
    `Precision, recall and false positive rate per engine over ` +
    `${num(table.corpus.testCases, { field: 'corpus.testCases' })} official ACT test cases. ` +
    `Marlo's own false positive rate is ` +
    `${num(marlo.falsePositiveRate, { as: 'percent', field: 'strict.falsePositiveRate.marlo' })}, third of four.`,
  body: `      <section class="hero">
        <div class="hero__grid" aria-hidden="true"></div>
        <div class="wrap hero__inner">
          <span class="eyebrow eyebrow--accent">Regenerated in CI on every push</span>
          <h1>The numbers, including the ones that are bad for us</h1>
          <p class="lede">
            One harness, one corpus, one code path, four engines. Marlo's engine is one of the
            four and gets no exemption, because a table where the author's own engine happened
            to win would be worth nothing.
          </p>
          ${scoreboard({ wide: true })}
        </div>
      </section>

      <section class="reveal">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">Per engine</span>
            <h2>Marlo is third of four</h2>
            <p>
              Alfa and axe-core are both more precise and more sensitive. Which is why the
              router sends ${num(routedTo('axe-core'), { field: 'routing.axe-core' })} rules to
              axe-core and only ${num(routedTo('marlo'), { field: 'routing.marlo' })} to
              Marlo's own engine.
            </p>
          </div>
          ${engineTable()}
          <div class="callout callout--warn" style="margin-top: 20px">
            <span class="callout__mark" aria-hidden="true">!</span>
            <p>
              <strong>HTML CodeSniffer's recall is
              ${num(engines.find((e) => e.id === 'htmlcs').recall, { as: 'rate', field: 'strict.recall.htmlcs' })}.</strong>
              It never returns a definite failure for any rule it claims. Its warnings and
              notices are advisory, which honestly means "cannot tell", and the adapter reads
              silence as a pass. That inference is the weakest step in the whole engines
              package. It stays in the table because it puts a number on exactly the gap the
              table exists to show.
            </p>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">The finding that reshaped the project</span>
            <h2>W3C's protocol will call an engine correct for answering "I don't know"</h2>
            <p>
              W3C defines how to grade an implementation against a rule's official test cases.
              Under that protocol <code>cantTell</code> is an allowed answer for
              <em>every</em> example type.
            </p>
          </div>
          <div class="prose stack">
            <p>
              So a tool that shrugs at all
              ${num(table.corpus.testCases, { field: 'corpus.testCases' })} test cases is,
              officially, a correct implementation of all
              ${num(table.corpus.rulesWithTestCases, { field: 'corpus.rulesWithTestCases' })}
              rules that have them.
            </p>
            <p>
              That is not a flaw in the protocol. It grades whether a tool <em>misleads</em>
              you, and "I don't know" misleads nobody. It is just not the question a developer
              is asking, which is whether the violation actually gets found.
            </p>
            <p>
              So the table publishes both views and computes the gap rather than leaving you to
              notice it. ${num(flattered.length, { field: 'entries.flattered.length' })} entries
              currently grade as officially consistent while missing more than half the
              violations a real user would hit.
              <strong>Two of the three are ours.</strong>
            </p>
          </div>
          <div class="scroller" role="region" aria-label="Rules where the official protocol flatters an engine, scrollable" tabindex="0" style="margin-top: 20px">
            <table>
              <caption>Officially a correct implementation. In practice, missing most of it.</caption>
              <thead>
                <tr>
                  <th scope="col">ACT rule</th>
                  <th scope="col">Engine</th>
                  <th scope="col">W3C verdict</th>
                  <th scope="col">Strict recall</th>
                </tr>
              </thead>
              <tbody>
${flattered
  .map(
    (e) => `                <tr${e.engine === 'marlo' ? ' class="is-marlo"' : ''}>
                  <th scope="row"><a href="https://act-rules.github.io/rules/${escapeHtml(e.actRuleId)}"><code>${escapeHtml(e.actRuleId)}</code></a></th>
                  <td>${escapeHtml(ENGINE_LABEL[e.engine])}</td>
                  <td>${escapeHtml(e.act.consistency)}</td>
                  <td class="num">${num(e.strict.recall, { as: 'rate', field: `strict.recall.${e.actRuleId}.${e.engine}` })}</td>
                </tr>`,
  )
  .join('\n')}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap">
          <div class="split">
            <div>
              <div class="section-head">
                <span class="eyebrow">Auto-fix</span>
                <h2>What Marlo may touch without asking</h2>
              </div>
              <div class="prose stack">
                <p>
                  A rule qualifies only when the engine reporting it clears
                  ${num(table.autoFixThreshold.minStrictPrecision, { as: 'rate', field: 'autoFixThreshold.minStrictPrecision' })}
                  strict precision over at least
                  ${num(table.autoFixThreshold.minSampleSize, { field: 'autoFixThreshold.minSampleSize' })}
                  official test cases.
                </p>
                <p>
                  The gate is precision, not recall, and the asymmetry is deliberate. A missed
                  violation is a gap you already had. A wrong fix is a change to your code that
                  you did not ask for.
                </p>
              </div>
            </div>
            <div class="tile tile--pad tile--glow">
              <div class="headline-stat">
                <span class="eyebrow">Rules cleared for auto-fix</span>
                <span class="headline-stat__value">${num(autoFixable, { field: 'derived.autoFixable' })}</span>
                <span class="headline-stat__label">
                  of ${num(routedTotal, { field: 'derived.routedTotal' })} routed rules.
                  Everything else gets flagged for a human.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>`,
});

const measurable = table.entries
  .filter((e) => e.engine === 'marlo' && e.mappingKind !== 'none')
  .sort((a, b) => a.actRuleId.localeCompare(b.actRuleId));

pages.push({
  slug: 'rules',
  path: 'rules/index.html',
  title: `The ${num(table.coverage.implemented, { field: 'coverage.implemented' })} ACT rules Marlo covers, with measured accuracy on each`,
  description:
    `Marlo implements ${num(table.coverage.implemented, { field: 'coverage.implemented' })} of ` +
    `${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })} published ACT rules, ` +
    `each with per-rule precision and recall measured against the official test cases.`,
  body: `      <section class="hero">
        <div class="hero__grid" aria-hidden="true"></div>
        <div class="wrap hero__inner">
          <span class="eyebrow eyebrow--accent">The numerator and the denominator</span>
          <h1>
            ${num(table.coverage.implemented, { field: 'coverage.implemented' })} rules of
            ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })}
          </h1>
          <p class="lede">
            A coverage percentage with no denominator is the claim this whole project exists to
            argue with. So
            ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })}
            sits next to every fraction here, including in the page title.
          </p>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap ruleset">
          <div class="section-head">
            <span class="eyebrow">Every rule</span>
            <h2>Who reports it, and how Marlo's own version measured</h2>
            <p>
              "Reported by" is the router's pick from the calibration table. Where that is not
              Marlo, Marlo's rule measured worse and a better engine took it.
            </p>
          </div>

          <fieldset class="filter">
            <legend>Filter by reporting engine</legend>
            <div class="filter__options">
              <input type="radio" name="engine-filter" id="by-all" checked />
              <label for="by-all">All ${num(measurable.length, { field: 'coverage.implemented' })}</label>
              <input type="radio" name="engine-filter" id="by-axe" />
              <label for="by-axe">axe-core ${num(routedTo('axe-core'), { field: 'routing.axe-core' })}</label>
              <input type="radio" name="engine-filter" id="by-marlo" />
              <label for="by-marlo">Marlo ${num(routedTo('marlo'), { field: 'routing.marlo' })}</label>
              <input type="radio" name="engine-filter" id="by-alfa" />
              <label for="by-alfa">Alfa ${num(routedTo('alfa'), { field: 'routing.alfa' })}</label>
              <input type="radio" name="engine-filter" id="by-autofix" />
              <label for="by-autofix">Auto-fixable ${num(autoFixable, { field: 'derived.autoFixable' })}</label>
            </div>
          </fieldset>

          <div class="scroller" role="region" aria-label="Every implemented rule with its measured accuracy, scrollable" tabindex="0">
            <table>
              <caption>
                Marlo's own measurement per rule on the static renderer. Rules that need layout
                report as not evaluated, never as passing.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Name</th>
                  <th scope="col">Reported by</th>
                  <th scope="col">Marlo P</th>
                  <th scope="col">Marlo R</th>
                  <th scope="col">Cases</th>
                </tr>
              </thead>
              <tbody>
${measurable
  .map((e) => {
    const routed = table.routing.find((r) => r.actRuleId === e.actRuleId);
    const chosen = routed?.chosen ?? null;
    return `                <tr data-engine="${escapeHtml(chosen ?? 'none')}" data-autofix="${routed?.autoFixPermitted === true ? 'yes' : 'no'}">
                  <th scope="row"><a href="https://act-rules.github.io/rules/${escapeHtml(e.actRuleId)}"><code>${escapeHtml(e.actRuleId)}</code></a></th>
                  <td>${escapeHtml(RULE_NAMES[e.actRuleId] ?? '')}</td>
                  <td>${escapeHtml(chosen === null ? 'nobody' : ENGINE_LABEL[chosen])}</td>
                  <td class="num">${num(e.strict.precision, { as: 'rate', field: `strict.precision.${e.actRuleId}` })}</td>
                  <td class="num">${num(e.strict.recall, { as: 'rate', field: `strict.recall.${e.actRuleId}` })}</td>
                  <td class="num">${num(e.testCaseCount, { field: `testCaseCount.${e.actRuleId}` })}</td>
                </tr>`;
  })
  .join('\n')}
              </tbody>
            </table>
          </div>
          <p class="dim">
            That filter is radio inputs and a CSS <code>:has()</code> selector. There is no
            JavaScript on this site, so where <code>:has()</code> is unsupported every row
            stays visible, which is the right way round to fail.
          </p>
        </div>
      </section>

      <section class="cta">
        <div class="wrap cta__inner">
          <h2>Want a rule that is not on the list?</h2>
          <p>
            One file, one registry line, one fixture set. A rule that measures badly still gets
            merged, published with its real numbers, and routed to a better engine. The only
            kind that cannot be merged is one with no measurement at all.
          </p>
          <div class="hero__actions">
            <a class="btn btn-primary" href="${REPO}/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Anew-rule">Pick one off the backlog${ICON.arrow}</a>
            <a class="btn btn-ghost" href="${REPO}/blob/main/CONTRIBUTING.md">How to add a rule</a>
          </div>
        </div>
      </section>`,
});

pages.push({
  slug: 'method',
  path: 'method/index.html',
  title: 'How Marlo measures itself, and the two mistakes the measurement caught',
  description:
    'The calibration harness runs four engines over the official ACT corpus through one code ' +
    'path with no exemptions, grades two ways, and commits the table.',
  body: `      <section class="hero">
        <div class="hero__grid" aria-hidden="true"></div>
        <div class="wrap hero__inner">
          <span class="eyebrow eyebrow--accent">The harness</span>
          <h1>How the measurement works, and where it went wrong first</h1>
          <p class="lede">
            Four engines, ${num(table.corpus.testCases, { field: 'corpus.testCases' })} official
            test cases, one code path. Nobody gets a longer timeout, a retry, or a special
            case. Marlo's engine goes through the same door as the others.
          </p>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap longform">
          <div class="section-head">
            <span class="eyebrow">The corpus</span>
            <h2>Vendored, hashed, and never fetched at runtime</h2>
          </div>
          <div class="prose stack">
            <p>
              All ${num(table.corpus.testCases, { field: 'corpus.testCases' })} test cases are
              committed with a SHA-256 each. Two reasons, and convenience is not one of them.
              CI has to be green with no network, which is also the only thing that makes the
              offline claim true rather than asserted. And a number that moved because somebody
              upstream edited a file is not a measurement, it is a reading.
            </p>
            <p>
              <code>pnpm corpus:verify</code> fails on a changed byte, on a file the manifest
              does not list, and on any drift in the documented totals. If a test case could be
              edited, an inconvenient result could be fixed by changing the question rather
              than the answer.
            </p>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap longform">
          <div class="section-head">
            <span class="eyebrow">Two mistakes</span>
            <h2>The first run was wrong, and both mistakes taught more than the code did</h2>
          </div>
          <div>
          <div class="prose stack">
            <h3>Every engine failed one rule in exactly the same way</h3>
            <p>
              All four, Marlo included, scored 0.67 precision on rule <code>b5c3f8</code> and
              graded as incorrect. Four independent engines failing identically is not four
              coincidences.
            </p>
            <p>
              That rule's two inapplicable examples are an SVG document and a MathML document.
              Writing either into an HTML document produces an HTML page <em>containing</em>
              that element, so all four engines correctly reported that the page's html element
              had no language. The finding was right about the document it was given. The
              document was wrong.
            </p>
            <p>
              The harness now refuses to grade a document the renderer cannot represent, and
              those cases get their own column so a reader can see how many test cases each
              number rests on. A measurement that could not be taken honestly is reported as not
              taken. Never as a result.
            </p>

            <h3>Then the fix turned out to be worse than the bug</h3>
            <p>
              The first correction rejected any document whose root element was not
              <code>html</code>. That skipped 444 of 524 cases and left every published number
              resting on a sixth of the corpus.
            </p>
            <p>
              Nobody questioned it, because the numbers <em>improved</em>. Marlo's precision
              went to 1.00 on several rules. An over-strict filter looks like caution and
              produces figures that mean nothing.
            </p>
            <p>
              Only a foreign-namespace root is genuinely unrepresentable. An HTML fragment is
              fine, because a browser wraps that in html and body too. Sample size went from 80
              back to ${num(marlo.sampleSize, { field: 'aggregate.sampleSize' })}.
            </p>
          </div>
          <div class="callout callout--bad">
            <span class="callout__mark" aria-hidden="true">!</span>
            <p>
              The rule written down afterwards: a change that makes your own numbers better
              deserves more scrutiny than one that makes them worse.
            </p>
          </div>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap longform">
          <div class="section-head">
            <span class="eyebrow">Capabilities</span>
            <h2>Layout is where honesty gets expensive</h2>
          </div>
          <div>
          <div class="prose stack">
            <p>
              A renderer declares what it has: <code>dom</code>, <code>script</code>,
              <code>layout</code>, <code>paint</code>. A rule declares what it needs. A rule
              whose needs are unmet reports <em>unsupported</em>, and unsupported is never a
              pass anywhere in this codebase.
            </p>
            <p>
              That one rule is what lets the default path run with no browser at all without
              quietly claiming coverage it does not have. It is enforced structurally rather
              than by review: the suite runs every rule twice, once with resolved styles and
              once without, and fails if a rule that did not declare <code>layout</code>
              changes its verdict.
            </p>
          </div>
          <div class="callout">
            <span class="callout__mark" aria-hidden="true">i</span>
            <p>
              axe-core arrived at the same conclusion independently, which was a pleasant
              surprise. Run over all 19 test cases for the minimum-contrast rule under the same
              Node DOM, it answered "cannot tell" every time and "failed" never, because the
              colours cannot be resolved without layout. Two engines declining for the same
              reason is a better argument than either one alone.
            </p>
          </div>
          </div>
        </div>
      </section>`,
});

pages.push({
  slug: 'honesty',
  path: 'honesty/index.html',
  title: 'Where Marlo was wrong',
  description:
    'Every case where Marlo produced a wrong result or made a claim it could not support, ' +
    'what reported success at the time, and the design change that followed.',
  body: `      <section class="hero">
        <div class="hero__grid" aria-hidden="true"></div>
        <div class="wrap hero__inner">
          <span class="eyebrow eyebrow--accent">This page existed before the product did</span>
          <h1>Where Marlo was wrong</h1>
          <p class="lede">
            Not a postmortem. A design constraint. A project whose pitch is "we tell you when we
            are wrong" needs somewhere to write that down before it has anything to be wrong
            about.
          </p>
          <p class="dim">
            The question each entry answers is not how bad it was. It is
            <strong>what reported success at the time.</strong> A loud crash is a changelog
            entry. A quiet wrong answer belongs here.
          </p>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap">
          <div class="rowset">
            <div class="row">
              <span class="row__tag">Reported success: nothing did</span>
              <span class="row__title">A security option that did nothing</span>
              <p class="row__body">
                The Node renderer shipped, in a first draft, with an option to disable script
                execution and a confident comment about not evaluating untrusted markup
                in-process. The option did not work. happy-dom runs inline scripts under every
                combination of its own switches, and its DOM parser runs them too, which the
                HTML specification says it must not.
              </p>
              <p class="row__body">
                An option named "do not run scripts" that runs scripts is worse than no option,
                because somebody would rely on it. It was removed. There is now a test asserting
                the real behaviour, so if a working switch ever appears the test fails and a
                human revisits the documentation, instead of the documentation going quietly
                stale.
              </p>
            </div>
            <div class="row">
              <span class="row__tag">Reported success: everything did</span>
              <span class="row__title">A report file that looked complete and was not</span>
              <p class="row__body">
                <code>marlo scan --json</code> into a file truncated at exactly 65526 bytes.
                Correct exit code. No warning. No error. What you got was a file that started
                like a report and would not parse.
              </p>
              <p class="row__body">
                <code>process.exit()</code> immediately after writing. To a terminal that write
                is synchronous; to a pipe it is not, and the process died before it drained. It
                sets the exit code and returns now, and a test pipes the JSON through a
                subprocess and parses it.
              </p>
              <p class="row__body">
                This is the failure mode the whole project is about, happening inside the
                project. Every line of logic was correct. The artifact was incomplete and looked
                whole.
              </p>
            </div>
            <div class="row">
              <span class="row__tag">Reported success: the harness did</span>
              <span class="row__title">The measurement was wrong before the code was</span>
              <p class="row__body">
                Two defects, both on the <a href="/method/">method page</a> in full. Every
                engine failed one rule identically because the harness misrepresented two test
                documents. Then the fix for that skipped 444 of 524 cases and left every number
                resting on a sixth of the corpus.
              </p>
              <p class="row__body">
                Neither was caught by a test. Both were caught by staring at a result that was
                suspiciously uniform. Which is the argument for publishing numbers at all: a
                number nobody reads is a number nobody checks.
              </p>
            </div>
            <div class="row">
              <span class="row__tag">Reported success: the architecture worked</span>
              <span class="row__title">Thirteen rules crashed and it took a real page to notice</span>
              <p class="row__body">
                The HTML CodeSniffer adapter treated a DOM node as a string. Thirteen rules
                threw at once, the first time the CLI met a real file. A crash is never a pass,
                so it was loud rather than silent, and that part is the design working.
              </p>
              <p class="row__body">
                Thirteen rules still went unmeasured, because no unit test exercised that
                adapter against markup with the shape that triggers it. The end to end suite now
                asserts zero crashes on the demo pages.
              </p>
            </div>
            <div class="row">
              <span class="row__tag">Reported success: 26 passing tests</span>
              <span class="row__title">This site failed Marlo's own bar</span>
              <p class="row__body">
                The first audit found serious violations on every page: 48 tap targets under 24
                CSS pixels, a light mode contrast failure at 2.18:1, and four scrollable regions
                no keyboard could reach. All 26 site tests passed throughout, because contrast
                needs layout and they have none.
              </p>
              <p class="row__body">
                The audit had a defect of its own. It loaded pages over <code>file://</code>, so
                the stylesheet never applied, and axe was measuring the browser's default link
                colour on white. It serves over HTTP now and refuses to believe any result until
                it has confirmed the CSS arrived.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap">
          <div class="section-head">
            <span class="eyebrow">Standing limitations</span>
            <h2>Not defects. Things Marlo cannot do, written down so the gap is a decision.</h2>
          </div>
          <div class="rowset rowset--2">
            <div class="row">
              <span class="row__title">The accessible name computation is incomplete</span>
              <p class="row__body">
                Where a name would depend on CSS generated content or the box tree, Marlo
                answers "cannot tell" and returns a confidence rather than pretending. That
                caution is why its recall on the naming rules sits below its peers', and the
                table shows exactly what it costs.
              </p>
            </div>
            <div class="row">
              <span class="row__title">Contrast never gets a ratio</span>
              <p class="row__body">
                Not even with a real browser. Doing it correctly needs the effective background
                behind any transparency, which is a paint-order walk this version does not
                implement. Marlo locates the text and names the declared colours. Asserting a
                ratio it had not computed would be a future entry on this page.
              </p>
            </div>
            <div class="row">
              <span class="row__title">Source locations are not implemented</span>
              <p class="row__body">
                Findings carry a DOM selector and say plainly that the source location arrives
                with the repair layer. A fabricated byte offset would look more finished and be
                worth less than nothing.
              </p>
            </div>
            <div class="row">
              <span class="row__title">One defect cannot be seen from a DOM at all</span>
              <p class="row__body">
                The demo page has a duplicated attribute on one input. Every HTML parser drops
                the second one before any DOM exists, so a DOM-based check is blind to it by
                construction. It is listed as undetected in
                <code>apps/demo/expected.json</code> rather than removed from the page, because
                an undetected defect nobody wrote down looks exactly like a defect that is not
                there.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="cta">
        <div class="wrap cta__inner">
          <h2>Was Marlo wrong about your code?</h2>
          <p>
            That is the most useful message this project can get, and reporting it is
            deliberately the shortest path in the repository. You do not need to know which ACT
            rule fired or which engine reported it. Every confirmed false positive becomes a
            fixture, so the same mistake fails the build afterwards.
          </p>
          <div class="hero__actions">
            <a class="btn btn-primary" href="${REPO}/issues/new?template=false-positive.yml">Report a false positive${ICON.arrow}</a>
            <a class="btn btn-ghost" href="${REPO}/blob/main/HONESTY.md">The full HONESTY.md</a>
          </div>
        </div>
      </section>`,
});

/* ── Static assets ───────────────────────────────────────────────────────────── */

/*
 * The palette again, as sRGB hex, because an SVG asset served as a file cannot read a CSS
 * custom property and oklch() is not safe in a favicon that a browser may rasterise in any
 * colour space.
 *
 * These have to agree with style.css. The first version did not: the stylesheet rendered its
 * accent as #00d3dd while the favicon was drawn in #4cc9e8, a paler and bluer cyan, so the
 * browser tab was a slightly different brand from the page it opened. The site test asserts
 * style.css still records the same values as these.
 */
const BG = '#09090b';
const INK = '#fafafa';
const ACCENT = '#c9f227';
const MUTED = '#a1a1aa';

/*
 * The tab icon is a ring rather than the square-in-square the wordmark uses. Browsers round,
 * crop and shrink a favicon to 16 pixels in a dozen contexts, and a circle survives all of
 * them: a square gets its corners clipped by the rounding a browser applies to a pinned tab,
 * and at 16 pixels a clipped corner reads as a rendering fault. Both shapes are concentric, so
 * the two marks stay recognisably the same idea.
 */
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Marlo">
  <circle cx="16" cy="16" r="16" fill="${BG}"/>
  <circle cx="16" cy="16" r="13" fill="${ACCENT}"/>
  <circle cx="16" cy="16" r="4.5" fill="${BG}"/>
</svg>
`;

const OG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Marlo. False positive rate ${num(marlo.falsePositiveRate, { as: 'percent', field: 'strict.falsePositiveRate.marlo' })}, measured and published.">
  <rect width="1200" height="630" fill="${BG}"/>
  <rect x="72" y="66" width="38" height="38" fill="${ACCENT}"/>
  <rect x="84" y="78" width="14" height="14" fill="${BG}"/>
  <text x="126" y="95" font-family="system-ui, sans-serif" font-size="30" font-weight="650" fill="${INK}">marlo</text>
  <text x="72" y="250" font-family="system-ui, sans-serif" font-size="58" font-weight="600" fill="${INK}">Our false positive rate is</text>
  <text x="72" y="394" font-family="ui-monospace, monospace" font-size="146" font-weight="600" fill="${ACCENT}">${num(marlo.falsePositiveRate, { as: 'percent', field: 'strict.falsePositiveRate.marlo' })}</text>
  <text x="72" y="456" font-family="system-ui, sans-serif" font-size="31" fill="${MUTED}">Measured over ${num(table.corpus.testCases, { field: 'corpus.testCases' })} official W3C test cases. Published anyway.</text>
  <text x="72" y="548" font-family="ui-monospace, monospace" font-size="25" fill="${MUTED}">${num(table.coverage.implemented, { field: 'coverage.implemented' })} of ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })} published ACT rules  .  trymarlo.pages.dev</text>
  <rect x="0" y="618" width="1200" height="12" fill="${ACCENT}"/>
</svg>
`;

/* ── Write ───────────────────────────────────────────────────────────────────── */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(resolve(OUT, 'fonts'), { recursive: true });

const urls = [];
for (const page of pages) {
  const canonical = `${ORIGIN}/${page.path.replace(/index\.html$/, '')}`;
  const html = layout({ ...page, canonical });
  const target = resolve(OUT, page.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html, 'utf8');
  urls.push(canonical);
}

copyFileSync(resolve(HERE, 'style.css'), resolve(OUT, 'style.css'));
for (const font of ['dm-sans-latin.woff2', 'jetbrains-mono-latin.woff2']) {
  copyFileSync(resolve(HERE, 'fonts', font), resolve(OUT, 'fonts', font));
}
writeFileSync(resolve(OUT, 'favicon.svg'), FAVICON, 'utf8');
writeFileSync(resolve(OUT, 'og.svg'), OG, 'utf8');

writeFileSync(
  resolve(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${table.generated}</lastmod></url>`).join('\n')}
</urlset>
`,
  'utf8',
);

writeFileSync(
  resolve(OUT, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`,
  'utf8',
);

// Headers. No script is served, so the policy can forbid script entirely, which is the
// strongest thing a static site can say about itself.
writeFileSync(
  resolve(OUT, '_headers'),
  `/*
  Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(), camera=(), microphone=()

/style.css
  Cache-Control: public, max-age=3600, must-revalidate

/fonts/*
  Cache-Control: public, max-age=31536000, immutable
`,
  'utf8',
);

console.log(`site: ${String(pages.length)} pages into apps/site/dist`);
console.log(
  `  coverage ${String(table.coverage.implemented)} of ${String(table.coverage.publishedActRules)}`,
);
console.log(
  `  marlo false positive rate ${marlo.falsePositiveRate === null ? 'not measured' : `${(marlo.falsePositiveRate * 100).toFixed(1)}%`}`,
);
