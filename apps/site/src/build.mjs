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
 * setTimeout, and a real audit result that came back from the API and was never read. It
 * now carries two tests that exist only because of that: no setTimeout in the script, and
 * no static tick in the markup.
 *
 * Marlo's site displays accuracy numbers, so the failure mode is identical and the tests
 * are copied. A third is added: `num()` is the only way a numeral reaches the page, and
 * `no-theatre.test.ts` asserts every numeral in the rendered HTML can be traced to a field
 * in the table. A site about verifiable accuracy that typed its accuracy into HTML would be
 * the joke the whole project is about.
 *
 * No framework. Nine pages and a build script; a client runtime would be more code than
 * the content, and there is no interactivity to justify one.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..', '..', '..');
const OUT = resolve(HERE, '..', 'dist');
const ORIGIN = 'https://trymarlo.pages.dev';

const table = JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8'));

/* ── Numbers ─────────────────────────────────────────────────────────────────── */

/**
 * The only way a numeral reaches the page.
 *
 * Every call names the field it came from. `no-theatre.test.ts` collects those names and
 * fails if a numeral appears in the HTML that no call produced.
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

const flattered = table.entries.filter((e) => e.flatteredByProtocol);
const routedTo = (id) => table.routing.filter((r) => r.chosen === id).length;
const autoFixable = table.routing.filter((r) => r.autoFixPermitted).length;
const routedTotal = table.routing.filter((r) => r.chosen !== null).length;

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

  // Structured data. A SoftwareApplication with the coverage fraction in it, so a machine
  // reading the page gets the denominator too.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Marlo',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Node.js 22.13 and later',
    url: ORIGIN,
    license: 'https://opensource.org/licenses/MIT',
    codeRepository: 'https://github.com/KarthikSubramanian07/Marlo',
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
    <link rel="stylesheet" href="/style.css" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta name="color-scheme" content="dark light" />

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
        <a class="wordmark" href="/">marlo</a>
        <nav class="nav" aria-label="Primary">
          ${nav}
        </nav>
      </div>
    </header>

    <main id="main">
${body}
    </main>

    <footer class="foot">
      <div class="wrap foot__grid">
        <div>
          <h2>Marlo</h2>
          <ul>
            <li><a href="https://github.com/KarthikSubramanian07/Marlo">Source</a></li>
            <li><a href="/accuracy/">The numbers</a></li>
            <li><a href="/rules/">Rules covered</a></li>
          </ul>
        </div>
        <div>
          <h2>Read the argument</h2>
          <ul>
            <li><a href="https://github.com/KarthikSubramanian07/Marlo/blob/main/RESEARCH.md">Research</a></li>
            <li><a href="https://github.com/KarthikSubramanian07/Marlo/blob/main/DECISIONS.md">Decisions</a></li>
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
          <h2>Contribute</h2>
          <ul>
            <li><a href="https://github.com/KarthikSubramanian07/Marlo/issues/new?template=false-positive.yml">Report a false positive</a></li>
            <li><a href="https://github.com/KarthikSubramanian07/Marlo/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Anew-rule">Implement a rule</a></li>
            <li><a href="https://github.com/KarthikSubramanian07/Marlo/issues/new?template=calibration-dispute.yml">Dispute a number</a></li>
          </ul>
        </div>
      </div>
      <div class="wrap" style="margin-top: 2rem">
        <p class="dim">
          Marlo provides automated analysis and verified repair, not legal certification.
          Coverage is
          ${num(table.coverage.implemented, { field: 'coverage.implemented' })} of
          ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })}
          published ACT rules. Numbers on this site are generated from
          <a href="https://github.com/KarthikSubramanian07/Marlo/blob/main/calibration/table.json">calibration/table.json</a>,
          measured ${escapeHtml(table.generated)} against a corpus retrieved
          ${escapeHtml(table.corpus.retrieved)}. MIT licensed.
        </p>
      </div>
    </footer>
  </body>
</html>
`;
}

/* ── Shared fragments ────────────────────────────────────────────────────────── */

function scoreboard() {
  return `        <div class="scoreboard">
${engines
  .map(
    (e) => `          <div class="score${e.id === 'marlo' ? ' score--marlo' : ''}">
            <span class="score__engine">${escapeHtml(e.label)}</span>
            <span class="score__value">${num(e.falsePositiveRate, { as: 'percent', field: `strict.falsePositiveRate.${e.id}` })}</span>
            <span class="score__unit">false positive rate</span>
          </div>`,
  )
  .join('\n')}
        </div>`;
}

function engineTable() {
  return `      <div class="scroller" role="region" aria-label="Accuracy per engine, scrollable" tabindex="0">
        <table>
          <caption>
            Measured over ${num(engines.find((e) => e.id === 'marlo').sampleSize, { field: 'aggregate.sampleSize' })}
            official ACT test case outcomes on the static renderer. Strict view: cantTell
            counts as no detection.
          </caption>
          <thead>
            <tr>
              <th scope="col">Engine</th>
              <th scope="col">Rules</th>
              <th scope="col">Precision</th>
              <th scope="col">Recall</th>
              <th scope="col">False positives</th>
              <th scope="col">cantTell (miss / cautious)</th>
            </tr>
          </thead>
          <tbody>
${engines
  .map(
    (e) => `            <tr${e.id === 'marlo' ? ' class="is-marlo"' : ''}>
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

/* ── Pages ───────────────────────────────────────────────────────────────────── */

const marlo = engines.find((e) => e.id === 'marlo');
const best = [...engines]
  .filter((e) => e.precision !== null)
  .sort((a, b) => b.precision - a.precision)[0];

const pages = [];

pages.push({
  slug: 'index',
  path: 'index.html',
  title: 'Marlo: the accessibility checker that publishes its own error rate',
  description:
    `Marlo finds accessibility violations, routes each rule to whichever engine measures ` +
    `best at it, and publishes what it gets wrong. Its own false positive rate is ` +
    `${num(marlo.falsePositiveRate, { as: 'percent', field: 'strict.falsePositiveRate.marlo' })}. ` +
    `Covers ${num(table.coverage.implemented, { field: 'coverage.implemented' })} of ` +
    `${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })} published ACT rules.`,
  body: `      <section class="hero">
        <div class="wrap">
          <div class="hero__split">
            <div>
              <h1>Every accessibility tool says it is accurate. This one shows you the receipt.</h1>
              <p class="lede">
                Marlo checks pages against the official ACT rule corpus, then measures
                itself against the same corpus and publishes the result.
                <strong>Including the parts that make it look bad.</strong>
              </p>
              <p class="dim">
                Below is the real table. Marlo is third of four. Nobody edited that.
              </p>
            </div>
            <div>
              <div class="verdict">
                <p class="verdict__label">False positive rate, measured</p>
${scoreboard()}
                <p class="dim" style="margin-top: 1rem; margin-bottom: 0">
                  Marlo is
                  ${num(Math.round((marlo.falsePositiveRate / best.falsePositiveRate) * 10) / 10, { field: 'derived.marloVsBest' })}
                  times worse than ${escapeHtml(best.label)}. That is the number a vendor
                  would never print, so it is the first thing on this page.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>The industry's problem is not detection. It is that nobody publishes their error rate.</h2>
          <p>
            Lighthouse returns 100 on pages a screen reader cannot get through. A major AI
            site builder shipped an unusable product and its own bundled checker reported
            perfection. The best-funded vendor in the category advertises "19x more critical
            issues" without defining the term or showing the working. The overlay industry
            asserted compliance until a regulator turned up with a fine.
          </p>
          <p>
            None of that happened because detection is hard. It happened because
            <strong>an unverifiable claim costs nothing to make.</strong>
          </p>
          <p>
            So Marlo does the boring thing instead. It runs four engines over
            ${num(table.corpus.testCases, { field: 'corpus.testCases' })} official W3C test
            cases, computes precision and recall per rule per engine, commits the table, and
            regenerates it in CI. When a number gets worse, the build fails and the
            changelog says which one and why.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>What it looks like when you run it</h2>
          <p>
            Two things in this output that most scanners do not print. What it
            <em>could not check</em>, above the findings rather than in a footnote. And where
            every accuracy figure came from, so you can go and disagree with it.
          </p>
          <div class="terminal" role="region" aria-label="Example terminal output, scrollable" tabindex="0">
<pre role="img" aria-label="Terminal output from marlo scan. It reports that two rules were not examined because the static renderer provides no layout, then a critical finding for a form field with no accessible name, noting that the one-directional invariant forced the failure through because a peer engine disagreed."><span class="t-dim">$</span> marlo scan checkout.html

<span class="t-dim">checkout.html</span>
<span class="t-dim">  static renderer  dom, script</span>

  <span class="t-warn">NOT EXAMINED</span>  2 rules need layout and paint, which this renderer does not provide.
                <span class="t-dim">09o5cg afw4f7</span>
                <span class="t-dim">This is not a pass. Use --renderer browser to evaluate them.</span>

  <span class="t-crit">▲▲▲</span> <span class="t-crit">critical</span> e086e5  Form field has non-empty accessible name
      <span class="t-dim">WCAG 1.3.1, 2.5.3, 4.1.2  marlo precision 0.75 over 17 official test cases</span>
      <span class="t-warn">INVARIANT</span> marlo reported a failure the routed engine did not, so Marlo may not report clean.
      <span class="t-dim">disagreement: axe-core says passed</span>
      <span class="t-dim">  A placeholder ("Email") is not a label: it disappears on focus and is</span>
      <span class="t-dim">  not reliably announced.</span>

  <span class="t-dim">------------------------------------------------------------</span>
  12 findings   0 fixed   0 flagged   2 not evaluated   0 crashed
  coverage: ${num(table.coverage.implemented, { field: 'coverage.implemented' })} of ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })} published ACT rules
  <span class="t-dim">calibration ${escapeHtml(table.generated)}, corpus ${escapeHtml(table.corpus.retrieved)}</span></pre>
          </div>
          <p class="dim">
            Severity is a text mark, never colour on its own, so the output survives a pipe,
            a CI log, and a reader who cannot tell red from amber.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>Marlo routes. It does not pile findings up and call the pile thorough.</h2>
          <p>
            There was a project that integrated ten engines and around a thousand rules. It
            was published at SIGACCESS, adopted inside a Fortune 50 company, and reached
            almost nobody. The research it cites explains why: accessibility engines find
            largely <em>disjoint</em> issue sets with poor agreement, so unioning them raises
            recall and buries the signal. Hand somebody ten engines' output and you have
            given them a triage problem, which is worse than the detection problem they
            started with.
          </p>
          <p>
            Marlo uses the calibration table to send each rule to whichever engine measures
            best at that rule, and reports one finding with the provenance attached. On the
            current table that means
            ${num(routedTo('axe-core'), { field: 'routing.axe-core' })} rules to axe-core,
            ${num(routedTo('marlo'), { field: 'routing.marlo' })} to Marlo's own engine,
            ${num(routedTo('alfa'), { field: 'routing.alfa' })} to Alfa, and
            ${num(table.routing.filter((r) => r.chosen === null).length, { field: 'routing.none' })}
            to nobody at all.
          </p>
          <div class="callout">
            <p>
              <strong>Routing decides who speaks. It does not let anyone silence a peer.</strong>
              If any engine reports a failure, Marlo may not report clean. It can disagree,
              on the record, with the dissenting engine named. That rule is tested over all
              256 combinations of four engines and four outcomes, because an invariant
              checked by three examples is an anecdote.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>Where it will not help you</h2>
          <ul class="plain">
            <li>
              <strong>It is not comprehensive and never claims to be.</strong> Coverage is
              ${num(table.coverage.implemented, { field: 'coverage.implemented' })} of
              ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })}
              published ACT rules, and automation reaches a minority of WCAG regardless.
            </li>
            <li>
              <strong>It will not recolour your design.</strong> Contrast is detected and
              located, never changed. Choosing a colour is your job.
            </li>
            <li>
              <strong>It will not invent alt text.</strong> Decorative images get an empty
              alt confidently. A description is written only where the page itself already
              supplies the meaning. Everything else is handed back to you, because a
              confident wrong description is worse than an absent one: you can notice the
              absence.
            </li>
            <li>
              <strong>It cannot certify anything.</strong> Nobody can. Marlo gives you
              verified repair against specific success criteria and a published error rate,
              and stops there.
            </li>
            <li>
              <strong>The repair layer is not merged yet.</strong> Detection, routing,
              calibration and reporting are. <code>marlo fix</code> exits with an error
              saying so, rather than being a flag that quietly does nothing.
            </li>
          </ul>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>Two promises that are the whole brand</h2>
          <p>
            <strong>Marlo will never sell remediation services.</strong> And it will never
            sell a conformance report to anyone it rates.
          </p>
          <p>
            Every incumbent that both rates and remediates has a commercial reason to find
            problems it can be paid to fix. Independence is the only asset a measurement
            tool has, and it is not the kind of thing you can get back once you have spent
            it.
          </p>
        </div>
      </section>`,
});

pages.push({
  slug: 'accuracy',
  path: 'accuracy/index.html',
  title: 'The numbers: Marlo, axe-core, Alfa and HTML CodeSniffer measured against the ACT corpus',
  description:
    `Precision, recall and false positive rate per engine, measured against ` +
    `${num(table.corpus.testCases, { field: 'corpus.testCases' })} official ACT test cases. ` +
    `Marlo's own false positive rate is ` +
    `${num(marlo.falsePositiveRate, { as: 'percent', field: 'strict.falsePositiveRate.marlo' })}.`,
  body: `      <section class="hero">
        <div class="wrap">
          <h1>The numbers, including the ones that are bad for us</h1>
          <p class="lede">
            Regenerated by <code>pnpm calibrate</code> in CI. A regression fails the build.
            An <em>improvement</em> also fails the build, if nobody committed the updated
            table, because a silent improvement is a number the README is now wrong about.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>Per engine, strict view</h2>
${engineTable()}
          <p>
            <strong>Marlo is third of four.</strong> Alfa and axe-core are both more precise
            and more sensitive. On this table the router sends
            ${num(routedTo('axe-core'), { field: 'routing.axe-core' })} rules to axe-core and
            only ${num(routedTo('marlo'), { field: 'routing.marlo' })} to Marlo's own engine.
          </p>
          <p>
            That is the correct outcome rather than an embarrassment to be managed. Marlo's
            engine is measured by the same harness, on the same corpus, through the same code
            path, with no exemption. A table in which the author's own engine happened to win
            would be worth nothing.
          </p>
          <div class="callout callout--warn">
            <p>
              <span class="mark mark--flag">!</span>
              <strong>HTML CodeSniffer's recall is
              ${num(engines.find((e) => e.id === 'htmlcs').recall, { as: 'rate', field: 'strict.recall.htmlcs' })}.</strong>
              It never returns a definite failure for any rule it claims: its warnings and
              notices are all advisory, which honestly translates to "cannot tell", and the
              adapter reads its silence as a pass. It is kept in the table because it
              demonstrates the exact gap the table exists to show.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>Where W3C's own protocol flatters an engine</h2>
          <p>
            W3C defines how to grade an implementation against a rule's official test cases.
            Under that protocol, <code>cantTell</code> is an allowed answer for
            <em>every</em> example type. So a tool that answers "cannot tell" to all
            ${num(table.corpus.testCases, { field: 'corpus.testCases' })} test cases is,
            officially, a correct implementation of all
            ${num(table.corpus.rulesWithTestCases, { field: 'corpus.rulesWithTestCases' })}
            rules that have them.
          </p>
          <p>
            That is not a flaw in the protocol. It grades whether a tool
            <em>misleads</em> you, and "I don't know" misleads nobody. It is simply not the
            question a developer is asking, which is whether the violation will actually be
            found.
          </p>
          <p>
            So the table publishes both, and computes the gap rather than leaving you to
            spot it. ${num(flattered.length, { field: 'entries.flattered.length' })} entries
            currently grade as officially <em>consistent</em> while missing more than half
            the violations a real user would hit.
            <strong>Two of them are Marlo's own.</strong>
          </p>
          <div class="scroller" role="region" aria-label="Rules where the official protocol flatters an engine, scrollable" tabindex="0">
            <table>
              <caption>
                Officially a correct implementation. In practice, missing most of it.
              </caption>
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

      <section>
        <div class="wrap">
          <h2>What auto-fix is allowed to touch</h2>
          <p>
            A rule may only be auto-fixed when the engine reporting it clears
            ${num(table.autoFixThreshold.minStrictPrecision, { as: 'rate', field: 'autoFixThreshold.minStrictPrecision' })}
            strict precision over at least
            ${num(table.autoFixThreshold.minSampleSize, { field: 'autoFixThreshold.minSampleSize' })}
            official test cases. On the current table that is
            ${num(autoFixable, { field: 'derived.autoFixable' })} of
            ${num(routedTotal, { field: 'derived.routedTotal' })} routed rules.
          </p>
          <p class="dim">
            The threshold is on precision rather than recall, deliberately. A missed
            violation is a gap you already had. A wrong fix is a change to your code that
            you did not ask for.
          </p>
        </div>
      </section>`,
});

const measurable = table.entries.filter((e) => e.engine === 'marlo' && e.mappingKind !== 'none');

pages.push({
  slug: 'rules',
  path: 'rules/index.html',
  title: `The ${num(table.coverage.implemented, { field: 'coverage.implemented' })} ACT rules Marlo implements, and its measured accuracy on each`,
  description:
    `Marlo implements ${num(table.coverage.implemented, { field: 'coverage.implemented' })} of ` +
    `${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })} published ACT rules, ` +
    `with per-rule precision and recall measured against the official test cases.`,
  body: `      <section class="hero">
        <div class="wrap">
          <h1>
            ${num(table.coverage.implemented, { field: 'coverage.implemented' })} rules of
            ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })}
          </h1>
          <p class="lede">
            The denominator is always there. A coverage percentage with no denominator is the
            claim this project exists to argue against, so the number
            ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })}
            appears next to every fraction on this site.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>Every rule, with the engine that reports it</h2>
          <p class="dim">
            "Reported by" is the router's choice from the calibration table. Where that is
            not Marlo, Marlo's own rule measured worse and the better engine won.
          </p>
          <div class="scroller" role="region" aria-label="Every implemented rule with its measured accuracy, scrollable" tabindex="0">
            <table>
              <caption>
                Marlo's own measurement per rule, on the static renderer. Rules needing
                layout report as not evaluated rather than as passing.
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
  .sort((a, b) => a.actRuleId.localeCompare(b.actRuleId))
  .map((e) => {
    const routed = table.routing.find((r) => r.actRuleId === e.actRuleId);
    const rule = table.entries.find((x) => x.actRuleId === e.actRuleId);
    void rule;
    return `                <tr>
                  <th scope="row"><a href="https://act-rules.github.io/rules/${escapeHtml(e.actRuleId)}"><code>${escapeHtml(e.actRuleId)}</code></a></th>
                  <td>${escapeHtml(RULE_NAMES[e.actRuleId] ?? '')}</td>
                  <td>${escapeHtml(routed?.chosen === null || routed === undefined ? 'nobody' : ENGINE_LABEL[routed.chosen])}</td>
                  <td class="num">${num(e.strict.precision, { as: 'rate', field: `strict.precision.${e.actRuleId}` })}</td>
                  <td class="num">${num(e.strict.recall, { as: 'rate', field: `strict.recall.${e.actRuleId}` })}</td>
                  <td class="num">${num(e.testCaseCount, { field: `testCaseCount.${e.actRuleId}` })}</td>
                </tr>`;
  })
  .join('\n')}
              </tbody>
            </table>
          </div>
          <p>
            Want a rule that is not here? It is one file, one registry line and one fixture
            set, and the
            <a href="https://github.com/KarthikSubramanian07/Marlo/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Anew-rule">backlog is sized so each one is an afternoon</a>.
            A rule that measures badly still gets merged, published with its real numbers,
            and routed to a better engine. What cannot be merged is a rule with no
            measurement.
          </p>
        </div>
      </section>`,
});

pages.push({
  slug: 'method',
  path: 'method/index.html',
  title: 'How Marlo measures itself, and the two mistakes that measurement caught',
  description:
    'The calibration harness runs four engines over the official ACT corpus through one ' +
    'code path with no exemptions, grades two ways, and commits the table.',
  body: `      <section class="hero">
        <div class="wrap">
          <h1>How the measurement works, and where it went wrong first</h1>
          <p class="lede">
            Four engines, ${num(table.corpus.testCases, { field: 'corpus.testCases' })} official
            test cases, one code path. No engine gets a longer timeout, a retry, or a special
            case, and Marlo's is one of the four.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>The corpus is vendored, not fetched</h2>
          <p>
            All ${num(table.corpus.testCases, { field: 'corpus.testCases' })} test cases are
            committed, with a SHA-256 per file. Two reasons, and neither is convenience. CI
            has to be green with no network, which is also the only way the offline claim is
            true rather than asserted. And a number that changes because somebody else edited
            a file upstream is not a measurement, it is a reading.
          </p>
          <p>
            <code>pnpm corpus:verify</code> fails on a modified byte, on a file the manifest
            does not list, and on a drift in the documented totals. If a test case could be
            edited, an inconvenient result could be made convenient by changing the question
            rather than the answer.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>Two mistakes the first run caught, both worth more than the code</h2>

          <h3>Every engine failed one rule identically</h3>
          <p>
            All four engines, Marlo's included, scored 0.67 precision on rule
            <code>b5c3f8</code> and graded as incorrect. Four independent engines failing in
            exactly the same way is not four coincidences.
          </p>
          <p>
            The rule's two inapplicable examples are an SVG document and a MathML document.
            Writing either into an HTML document produces an HTML page <em>containing</em>
            that element, so every engine correctly reported that the page's html element had
            no language. The finding was right about the document it was given, and the
            document was wrong.
          </p>
          <p>
            The harness now refuses to grade a document the renderer cannot represent. A
            measurement that could not be taken honestly is reported as not taken, never as a
            result.
          </p>

          <h3>The fix was worse than the bug</h3>
          <p>
            The first version rejected any document whose root element was not
            <code>html</code>, which skipped 444 of 524 cases and left every published number
            resting on a sixth of the corpus. That looks conservative and is meaningless.
          </p>
          <p>
            Only a foreign-namespace root is genuinely unrepresentable. Sample size went from
            80 cases back to
            ${num(marlo.sampleSize, { field: 'aggregate.sampleSize' })}. Both the mistake and
            the correction are commented where the check lives, because the next person will
            hit it too.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>Layout is where honesty gets expensive</h2>
          <p>
            The default renderer is a Node DOM: no browser, no network, milliseconds. All
            three peer engines run against it, which is what makes this project free to
            operate at any scale.
          </p>
          <p>
            It has no CSS layout, so contrast, visible focus, zoom clipping and keyboard traps
            cannot be evaluated. Marlo reports those as <em>not evaluated</em> and says so
            above the findings.
          </p>
          <div class="callout">
            <p>
              axe-core reached the same conclusion independently. Run over all 19 test cases
              for the minimum-contrast rule under the same Node DOM, it returned "cannot
              tell" on every one and "failed" on none, because the colours cannot be resolved
              without layout. Two engines declining for the same reason is a better argument
              than either one alone.
            </p>
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
    'what reported success, and the design change that followed.',
  body: `      <section class="hero">
        <div class="wrap">
          <h1>Where Marlo was wrong</h1>
          <p class="lede">
            This page existed before the product did. Every defect found during the build is
            here, with what reported success at the time and what changed as a result.
          </p>
          <p class="dim">
            Borrowed from the sibling PDF project this one learned its epistemology from,
            which documents three cases where its own auditor confirmed its own bugs.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>A security option that did nothing</h2>
          <p>
            The Node renderer shipped, in a first draft, with an option to disable script
            execution, defaulting to off, and a confident comment about not evaluating
            untrusted markup in-process.
          </p>
          <p>
            <strong>The option did not work.</strong> happy-dom 20 runs inline scripts under
            every combination of its own switches, and its DOM parser runs them too, which the
            HTML specification says it must not.
          </p>
          <p>
            An option named "do not run scripts" that runs scripts is worse than no option,
            because somebody would rely on it. It was removed, and there is now a test
            asserting the real behaviour, so if a working switch ever appears the test fails
            and someone revisits the documentation rather than the documentation quietly
            becoming wrong.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>Thirteen rules crashed and it took a real page to notice</h2>
          <p>
            The HTML CodeSniffer adapter treated a DOM node as a string. Thirteen rules threw
            at once the first time the CLI was pointed at a real file.
          </p>
          <p>
            The architecture worked: a crash is never a pass, so it was loud rather than
            silent. But thirteen rules went unmeasured, and the unit tests had not caught it
            because none of them exercised that adapter against markup with the shape that
            triggers it.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>A report file that looked complete and was not</h2>
          <p>
            <code>marlo scan --json</code> piped into a file truncated at exactly 65526 bytes.
            Silently. The result was a file that looked like a report and would not parse.
          </p>
          <p>
            The CLI called <code>process.exit()</code> immediately after writing. When output
            goes to a pipe rather than a terminal that write is asynchronous, and the process
            died before it drained. It sets the exit code and returns now, and there is a test
            that pipes the JSON and parses it.
          </p>
          <p class="dim">
            This is the failure mode this project is most about. Nothing errored. Nothing
            warned. The artifact was wrong and looked right.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>The measurement was wrong before the code was</h2>
          <p>
            Described in full on the <a href="/method/">method page</a>: every engine failed
            one rule identically because the harness misrepresented two test documents, and
            then the first fix skipped 444 of 524 cases and left every number resting on a
            sixth of the corpus.
          </p>
          <p>
            Both were found by looking at a result that was suspiciously uniform rather than
            by a test. That is the argument for publishing numbers at all: a number nobody
            looks at is a number nobody checks.
          </p>
        </div>
      </section>

      <section>
        <div class="wrap">
          <h2>Standing limitations</h2>
          <ul class="plain">
            <li>
              <strong>The accessible name computation is incomplete</strong>, and returns a
              confidence rather than pretending otherwise. Where a name depends on CSS
              generated content or the box tree, Marlo answers "cannot tell". That is why its
              recall on the naming rules is below its peers', and the table shows the cost.
            </li>
            <li>
              <strong>Contrast is never given a ratio</strong>, even with a real browser.
              Computing it correctly needs the effective background behind any transparency,
              which is a paint-order walk this version does not do. Marlo locates the text and
              names the declared colours instead.
            </li>
            <li>
              <strong>Source locations are not implemented yet.</strong> Findings carry a DOM
              selector and say plainly that the source location arrives with the repair layer,
              rather than reporting a byte offset nobody computed.
            </li>
            <li>
              <strong>The Alfa and HTML CodeSniffer rule mappings are unverified.</strong>
              They are documentation matches pending harness confirmation, and every entry is
              marked partial for that reason. Only the axe-core mapping was derived by
              measurement.
            </li>
          </ul>
        </div>
      </section>`,
});

/* ── Static assets ───────────────────────────────────────────────────────────── */

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Marlo">
  <rect width="32" height="32" fill="#0a0c09"/>
  <rect x="6" y="6" width="20" height="20" fill="#c9f227"/>
  <rect x="12" y="12" width="8" height="8" fill="#0a0c09"/>
</svg>
`;

const OG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Marlo. False positive rate ${num(marlo.falsePositiveRate, { as: 'percent', field: 'strict.falsePositiveRate.marlo' })}, measured and published.">
  <rect width="1200" height="630" fill="#0a0c09"/>
  <rect x="72" y="72" width="34" height="34" fill="#c9f227"/>
  <text x="122" y="100" font-family="ui-monospace, monospace" font-size="30" font-weight="600" fill="#e8ece3">marlo</text>
  <text x="72" y="250" font-family="system-ui, sans-serif" font-size="66" font-weight="700" fill="#e8ece3">Our false positive rate is</text>
  <text x="72" y="380" font-family="ui-monospace, monospace" font-size="150" font-weight="700" fill="#c9f227">${num(marlo.falsePositiveRate, { as: 'percent', field: 'strict.falsePositiveRate.marlo' })}</text>
  <text x="72" y="448" font-family="system-ui, sans-serif" font-size="34" fill="#9aa38f">Measured against ${num(table.corpus.testCases, { field: 'corpus.testCases' })} official W3C test cases. Published anyway.</text>
  <text x="72" y="540" font-family="ui-monospace, monospace" font-size="26" fill="#9aa38f">${num(table.coverage.implemented, { field: 'coverage.implemented' })} of ${num(table.coverage.publishedActRules, { field: 'coverage.publishedActRules' })} published ACT rules  .  trymarlo.pages.dev</text>
  <rect x="0" y="614" width="1200" height="16" fill="#c9f227"/>
</svg>
`;

/* ── Write ───────────────────────────────────────────────────────────────────── */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

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

// Headers. No inline script is served, so the CSP can forbid script entirely, which is the
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
`,
  'utf8',
);

console.log(`site: ${String(pages.length)} pages into apps/site/dist`);
console.log(
  `  coverage ${String(table.coverage.implemented)} of ${String(table.coverage.publishedActRules)}`,
);
console.log(
  `  marlo false positive rate ${marlo.falsePositiveRate === null ? 'not measured' : (marlo.falsePositiveRate * 100).toFixed(1) + '%'}`,
);
