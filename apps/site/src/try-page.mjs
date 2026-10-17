/**
 * /try/: Marlo in the browser, with nothing to install.
 *
 * The only page on the site that serves a script, and the script is Marlo itself: the
 * playground runs Marlo's own rules on pasted markup, and the bookmarklet runs them on any
 * page the visitor opens. Both are bundled here from the rule sources at build time, so the
 * site build needs no `pnpm build` first and cannot ship rules older than the repository.
 *
 * The page's policy allows script from this origin only, and `connect-src 'none'`: the
 * script can make no request, so nothing pasted can leave the browser.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

/**
 * The policy for /try/ and the two scripts it serves. build.mjs hands it to the worker and
 * writes it into _headers, so both say the same thing.
 *
 * Script from this origin only. The playground may connect to exactly three places: this
 * site's page fetch, GitHub's API and GitHub's raw file host. The preview may load a checked
 * page's own stylesheets, images and fonts over https, so the layout rules see it styled,
 * and its base URL may be any https address for the same reason. The checked page's scripts
 * never run: the frame has no allow-scripts.
 */
export const TRY_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https:; " +
  "img-src 'self' data: https:; font-src 'self' data: https:; frame-src 'self'; " +
  "connect-src 'self' https://api.github.com https://raw.githubusercontent.com; " +
  "base-uri https:; form-action 'none'; frame-ancestors 'none'";

/** Addresses to try, shown as buttons under the address box. */
const ADDRESSES = [
  // Each one is checked against production before it is listed. The W3C's demo refuses
  // Cloudflare's Workers, so it shows the browser fallback at work.
  ['https://dequeuniversity.com/demo/mars/', "Deque's deliberately inaccessible demo"],
  ['https://www.w3.org/WAI/demos/bad/before/home.html', "The W3C's inaccessible demo"],
  ['https://www.gov.uk/', 'GOV.UK, a well-built real site'],
  ['github.com/KarthikSubramanian07/Marlo/tree/main/apps/demo', "Marlo's demo pages on GitHub"],
];

const SAMPLES = [
  ['checkout', 'Broken checkout', 'apps/demo/checkout.html'],
  ['settings', 'Broken settings', 'apps/demo/settings.html'],
  ['clean', 'A clean page', 'apps/demo/clean.html'],
];

/**
 * Bundles the playground and the bookmarklet into `out/try/`.
 *
 * `marlo:meta` is generated: rule names and success criteria from @trymarlo/act, severity from
 * the CLI's own table, and Marlo's measured precision per rule from calibration/browser.json,
 * because both surfaces run the rules in a browser.
 */
export async function buildTryBundles({ root, out, browserTable }) {
  const precision = {};
  for (const entry of browserTable.entries) {
    if (entry.engine !== 'marlo' || entry.mappingKind === 'none') continue;
    precision[entry.actRuleId] = {
      precision: entry.strict.precision,
      testCases: entry.testCaseCount,
    };
  }
  const samples = Object.fromEntries(
    SAMPLES.map(([id, label, file]) => [
      id,
      { label, html: readFileSync(resolve(root, file), 'utf8') },
    ]),
  );
  const version = JSON.parse(
    readFileSync(resolve(root, 'packages/rules/package.json'), 'utf8'),
  ).version;
  const metaSource = `
import { IMPLEMENTED_RULES } from '@trymarlo/rules';
import { findRule } from '@trymarlo/act';
import { severityOf } from ${JSON.stringify(resolve(root, 'packages/cli/src/severity.ts'))};
const PRECISION = ${JSON.stringify(precision)};
const rules = {};
for (const id of IMPLEMENTED_RULES) {
  const rule = findRule(id);
  rules[id] = {
    name: rule ? rule.name : id,
    criteria: rule ? [...rule.successCriteria] : [],
    severity: severityOf(id),
    precision: PRECISION[id] ? PRECISION[id].precision : null,
    testCases: PRECISION[id] ? PRECISION[id].testCases : 0,
  };
}
export const META = { version: ${JSON.stringify(version)}, rules, samples: ${JSON.stringify(samples)} };
`;
  const workspace = {
    name: 'marlo-workspace',
    setup(b) {
      // Rule sources, not built packages: the site build runs where nothing is built yet.
      b.onResolve({ filter: /^@trymarlo\// }, (args) => ({
        path: resolve(root, 'packages', args.path.split('/')[1], 'src', 'index.ts'),
      }));
      b.onResolve({ filter: /^marlo:meta$/ }, () => ({ path: 'marlo:meta', namespace: 'meta' }));
      b.onLoad({ filter: /.*/, namespace: 'meta' }, () => ({
        contents: metaSource,
        loader: 'js',
        resolveDir: root,
      }));
    },
  };
  mkdirSync(resolve(out, 'try'), { recursive: true });
  const common = {
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    absWorkingDir: root,
    plugins: [workspace],
    logLevel: 'warning',
  };
  await build({
    ...common,
    entryPoints: [resolve(root, 'apps/site/src/try/playground.mjs')],
    format: 'esm',
    outfile: resolve(out, 'try/playground.js'),
  });
  await build({
    ...common,
    entryPoints: [resolve(root, 'apps/site/src/try/bookmarklet.mjs')],
    format: 'iife',
    outfile: resolve(out, 'try/marlo-page.js'),
  });
  return { samples: SAMPLES.map(([id, label]) => ({ id, label })) };
}

/** The bookmarklet: one line that loads the panel script from this origin. */
export function bookmarklet(origin) {
  return (
    "javascript:(()=>{const s=document.createElement('script');" +
    `s.src='${origin}/try/marlo-page.js';s.onerror=()=>alert('Marlo could not load here. This page may forbid scripts from other sites. You can paste its HTML into ${origin}/try/ instead.');` +
    'document.documentElement.appendChild(s)})()'
  );
}

export function tryPage({ origin, repo, samples, escapeHtml, scribble }) {
  const addressButtons = ADDRESSES.map(
    ([value, label]) =>
      `<button type="button" class="btn btn-ghost try__sample" data-address="${escapeHtml(value)}">${escapeHtml(label)}</button>`,
  ).join('\n              ');
  const sampleButtons = samples
    .map(
      (s) =>
        `<button type="button" class="btn btn-ghost try__sample" data-sample="${s.id}">${escapeHtml(s.label)}</button>`,
    )
    .join('\n                ');
  const docker =
    'docker run --rm -v "$PWD:/work" ghcr.io/karthiksubramanian07/marlo scan page.html';
  return {
    slug: 'try',
    path: 'try/index.html',
    title: 'Try Marlo: check a website, a GitHub repository or some HTML for accessibility',
    description:
      "Enter a web address or a GitHub repository, or paste HTML, and Marlo's own accessibility " +
      'rules check it in your browser, with the measured precision of every rule beside each ' +
      'finding. Or check any page you open with the bookmarklet.',
    scripts: ['/try/playground.js'],
    body: `      <section class="hero">
        <div class="hero__grid" aria-hidden="true"></div>
        <div class="wrap hero__inner">
          <span class="eyebrow eyebrow--accent">Try it</span>
          <h1>Point it at a site. See what fails, and how sure Marlo is.</h1>
          <p class="lede">
            A web address, a GitHub repository, or a paste of HTML. Marlo's own rules run here,
            in your browser, and every finding carries the rule's measured precision.
          </p>
        </div>
      </section>

      <section class="try">
        <div class="wrap">
          <form id="mt-url-form" class="try__address tile tile--pad" novalidate>
            ${scribble('any public site works. go on.', { arrow: 'down-left', place: 'address' })}
            <label class="try__label" for="mt-url">Web address or GitHub repository</label>
            <div class="try__address-row">
              <input id="mt-url" class="try__url" type="text" inputmode="url" autocomplete="url"
                spellcheck="false" placeholder="example.com or github.com/owner/repo"
                aria-describedby="mt-url-hint" />
              <button type="submit" id="mt-go" class="btn btn-primary" disabled>Check it</button>
            </div>
            <p id="mt-url-hint" class="try__hint dim">
              A web address is fetched once by this site, which hands back that page's HTML and
              keeps nothing. If the site refuses automated requests, or builds itself with
              JavaScript, a real browser in Cloudflare loads it instead. A repository is read
              straight from GitHub, up to twenty-five of its HTML files. The preview never runs
              the page's scripts.
            </p>
            <div class="try__samples" role="group" aria-label="Addresses to try">
              <span class="dim">Try:</span>
              ${addressButtons}
            </div>
          </form>

          <p id="mt-status" class="try__status" role="status" aria-live="polite">Loading Marlo's rules.</p>
          <noscript><p class="try__status">The playground runs Marlo in your browser, which needs JavaScript. Everything else on this site works without it.</p></noscript>
        </div>

        <div class="wrap try__grid">
          <details id="mt-paste" class="try__input tile tile--pad">
            <summary class="try__label">Or paste HTML</summary>
            <label class="visually-hidden" for="mt-source">HTML to check</label>
            <textarea id="mt-source" class="try__source" spellcheck="false" autocomplete="off"
              placeholder="&lt;!doctype html&gt; ..." aria-describedby="mt-hint"></textarea>
            <p id="mt-hint" class="try__hint dim">
              Pasted HTML never leaves this page. Relative links in it go nowhere.
            </p>
            <div class="try__actions">
              <button type="button" id="mt-run" class="btn btn-primary" disabled>Check the paste</button>
            </div>
            <div class="try__samples" role="group" aria-label="Examples">
              <span class="dim">Examples:</span>
                ${sampleButtons}
            </div>
          </details>
          <div class="try__preview tile">
            <p class="try__label try__label--pad">Preview, with the page's scripts off</p>
            <iframe id="mt-frame" class="try__frame" title="Preview of the page being checked"
              sandbox="allow-same-origin" srcdoc="&lt;!doctype html&gt;&lt;title&gt;Nothing yet&lt;/title&gt;"></iframe>
          </div>
        </div>
        <div class="wrap">
          <div id="mt-files"></div>
          <div id="mt-results" class="try__results" aria-label="Findings"></div>
          <div class="try__actions try__actions--end">
            <button type="button" id="mt-download" class="btn btn-ghost" hidden>Download the report as JSON</button>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap longform">
          <div class="section-head">
            <span class="eyebrow">What runs here</span>
            <h2>One engine of four, and it says so</h2>
          </div>
          <div class="prose stack">
            <p>
              This is Marlo's own rule engine, the same code <code>marlo scan --renderer browser</code>
              injects into Chromium. The command line also runs axe-core, Alfa and HTML
              CodeSniffer, routes each rule to the engine measured most precise, and refuses to
              report a rule clean when any engine failed it. None of that happens here, so this
              page finds less than the command line does, and its misses are Marlo's own. The
              <a href="/accuracy/">numbers page</a> says how often Marlo's engine is wrong, on
              the official cases and on real pages.
            </p>
            <p>
              A rule that needs a person to decide says so instead of guessing, and a rule that
              could not run is listed as not examined. Neither is a pass.
            </p>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap longform">
          <div class="section-head">
            <span class="eyebrow">Any page you open</span>
            <h2>The bookmarklet</h2>
          </div>
          <div class="prose stack">
            <p>
              ${scribble('works on pages built with JavaScript, too', { arrow: 'down', place: 'bookmarklet' })}
              Drag this to your bookmarks bar, open any page, and click it:
              <a class="btn btn-ghost try__bookmarklet" href="${escapeHtml(bookmarklet(origin))}">Check with Marlo</a>
            </p>
            <p>
              It loads Marlo's rules from this site, checks the page as your browser has
              rendered it, and opens a panel listing each failure. Choose an element in the
              panel to outline it on the page. It sends nothing back. Some sites forbid
              scripts from other origins, and on those it will say it cannot run, which is the
              site's security policy doing its job.
            </p>
          </div>
        </div>
      </section>

      <section class="reveal">
        <div class="wrap longform">
          <div class="section-head">
            <span class="eyebrow">Beyond the browser</span>
            <h2>Every other way in</h2>
          </div>
          <div class="rowset">
            <div class="row">
              <h3 class="row__title">Command line</h3>
              <div class="row__body prose">
                <p>All four engines, routing, the invariant and SARIF. No network after install.</p>
                <pre class="scroller"><code>git clone ${repo}.git
cd Marlo &amp;&amp; pnpm install &amp;&amp; pnpm build
node packages/cli/dist/bin.js scan page.html</code></pre>
              </div>
            </div>
            <div class="row">
              <h3 class="row__title">Docker</h3>
              <div class="row__body prose">
                <p>The command line with nothing to install but Docker. Mount the folder to scan.</p>
                <pre class="scroller"><code>${escapeHtml(docker)}</code></pre>
              </div>
            </div>
            <div class="row">
              <h3 class="row__title">GitHub Action</h3>
              <div class="row__body prose">
                <p>Read-only by default. Results land in the code scanning tab as SARIF.</p>
                <pre class="scroller"><code>- uses: KarthikSubramanian07/Marlo/.github/actions/marlo@main</code></pre>
                <p><a class="textlink" href="${repo}/tree/main/.github/actions/marlo">Inputs and the opt-in pull request mode</a></p>
              </div>
            </div>
            <div class="row">
              <h3 class="row__title">MCP, for coding agents</h3>
              <div class="row__body prose">
                <p>
                  A remote, read-only endpoint for coverage and per-rule accuracy at
                  <code>${origin}/mcp</code>, and a local server, <code>@trymarlo/mcp</code>, that
                  scans the markup an agent just wrote. Neither has a tool that writes.
                </p>
                <p><a class="textlink" href="/developers/">Developer portal</a></p>
              </div>
            </div>
          </div>
        </div>
      </section>
`,
  };
}
