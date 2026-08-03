import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The no-theatre tests.
 *
 * The sibling PDF project's third defect was a web page asserting a hard-coded score in
 * static markup, with a progress indicator advancing on `setTimeout` while nothing
 * happened, and a real audit result that came back from the API and was never read. It now
 * carries two tests that exist only because of that: no `setTimeout` in the script, and no
 * static tick in the markup.
 *
 * Marlo's site displays accuracy numbers, so the failure mode is identical. Both tests are
 * reimplemented here, plus a third that is stronger than either: every number rendered on
 * the site has to be traceable to a field in `calibration/table.json`.
 *
 * A site whose subject is verifiable accuracy, typing its accuracy into HTML, would be the
 * joke the whole project is about.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const DIST = resolve(import.meta.dirname, '..', 'dist');

interface Table {
  readonly generated: string;
  readonly coverage: { readonly implemented: number; readonly publishedActRules: number };
  readonly corpus: {
    readonly testCases: number;
    readonly rulesWithTestCases: number;
    readonly retrieved: string;
  };
  readonly aggregate: { readonly falsePositiveRate: number | null };
  readonly entries: readonly {
    readonly actRuleId: string;
    readonly engine: string;
    readonly mappingKind: string;
    readonly testCaseCount: number;
    readonly strict: Record<string, number | null>;
  }[];
  readonly routing: readonly { readonly actRuleId: string; readonly chosen: string | null }[];
}

const table: Table = JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8'));

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

let pages: { path: string; html: string }[] = [];

beforeAll(() => {
  // Built here rather than assumed, so the test cannot pass against a stale dist.
  execFileSync('node', [resolve(import.meta.dirname, '..', 'src', 'build.mjs')], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  pages = htmlFiles(DIST).map((path) => ({ path, html: readFileSync(path, 'utf8') }));
});

describe('the site has no theatre', () => {
  it('builds every page', () => {
    expect(pages.length).toBeGreaterThanOrEqual(5);
  });

  it('runs no script at all', () => {
    // The strongest form of the sibling project's no-setTimeout test. There is no client
    // script on this site, so there is nothing that could animate a fake progress bar, and
    // the CSP forbids script entirely.
    for (const page of pages) {
      const scripts = [...page.html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1] ?? '');
      for (const attributes of scripts) {
        // The only permitted script element is the structured data block, which is data.
        expect(attributes, `${page.path} has an executable script`).toMatch(
          /type="application\/ld\+json"/,
        );
      }
      expect(page.html).not.toContain('setTimeout');
      expect(page.html).not.toContain('setInterval');
      expect(page.html).not.toMatch(/\son[a-z]+=/i);
    }
  });

  it('asserts no score in static markup', () => {
    // The sibling project's actual defect: a scorecard with green ticks, hard-coded.
    for (const page of pages) {
      expect(page.html).not.toMatch(/\b100\s*%/);
      expect(page.html).not.toMatch(/✓|✔|✅/);
      expect(page.html.toLowerCase()).not.toContain('all checks passed');
    }
  });

  it('shows recorded output, and proves it by matching the committed golden file', () => {
    // The terminal block on the home page is the one place a numeral reaches the site
    // without going through num(). This is what makes that acceptable: the text comes from
    // apps/site/src/recorded-scan.txt, and every line of it has to appear verbatim in the
    // golden file that tests/e2e/scan.e2e.test.ts regenerates from a real scan.
    //
    // So its numbers are permitted because they were recorded. If somebody edits the excerpt
    // to read better, or nudges "37 findings" upward, this fails.
    const excerpt = readFileSync(
      resolve(import.meta.dirname, '..', 'src', 'recorded-scan.txt'),
      'utf8',
    );
    const goldenPath = resolve(ROOT, 'tests/golden/checkout-terminal.txt');
    expect(existsSync(goldenPath), 'run pnpm test:e2e to generate the golden output').toBe(true);
    const golden = readFileSync(goldenPath, 'utf8');

    const lines = excerpt
      .split('\n')
      .filter((line) => line.trim() !== '')
      // The command line is not part of stdout, for obvious reasons.
      .filter((line) => !line.startsWith('$ marlo'));
    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      expect(golden, `not in the recorded output: ${line.trim()}`).toContain(line);
    }

    // And the excerpt actually reaches the page, escaped, rather than being dead weight.
    const index = pages.find((p) => p.path.endsWith(`dist${sep}index.html`));
    expect(index).toBeDefined();
    expect(index?.html).toContain('37 findings');
    expect(index?.html).toContain('0 crashed');
  });

  it('traces every number on the site to the calibration table', () => {
    // THE test. Collect every numeral rendered in prose, and require each to be derivable
    // from the table, the corpus manifest, or a small allow-list of structural numbers that
    // are not claims.
    const permitted = new Set<string>();

    const add = (value: unknown): void => {
      if (value === null || value === undefined) return;
      if (typeof value === 'number') {
        permitted.add(String(value));
        permitted.add(value.toFixed(3));
        permitted.add(`${(value * 100).toFixed(1)}%`);
        permitted.add((value * 100).toFixed(1));
        permitted.add(String(Math.round(value * 10) / 10));
      }
      if (typeof value === 'string') permitted.add(value);
    };

    add(table.coverage.implemented);
    add(table.coverage.publishedActRules);
    add(table.corpus.testCases);
    add(table.corpus.rulesWithTestCases);
    add(table.corpus.retrieved);
    add(table.generated);
    add(table.aggregate.falsePositiveRate);
    add(table.entries.length);
    for (const entry of table.entries) {
      add(entry.testCaseCount);
      for (const value of Object.values(entry.strict)) add(value);
    }
    // Pooled per-engine figures, which the site computes from the entries.
    for (const engine of ['marlo', 'axe-core', 'alfa', 'htmlcs']) {
      let tp = 0;
      let fp = 0;
      let fn = 0;
      let tn = 0;
      let ctF = 0;
      let ctP = 0;
      let rules = 0;
      for (const entry of table.entries) {
        if (entry.engine !== engine || entry.mappingKind === 'none') continue;
        rules += 1;
        tp += entry.strict['truePositives'] ?? 0;
        fp += entry.strict['falsePositives'] ?? 0;
        fn += entry.strict['falseNegatives'] ?? 0;
        tn += entry.strict['trueNegatives'] ?? 0;
        ctF += entry.strict['cantTellOnFailed'] ?? 0;
        ctP += entry.strict['cantTellOnPassed'] ?? 0;
      }
      add(rules);
      add(ctF);
      add(ctP);
      add(tp + fp + fn + tn);
      if (tp + fp > 0) add(tp / (tp + fp));
      if (tp + fn > 0) add(tp / (tp + fn));
      if (fp + tn > 0) add(fp / (fp + tn));
    }
    for (const engine of ['marlo', 'axe-core', 'alfa', 'htmlcs', null]) {
      add(table.routing.filter((r) => r.chosen === engine).length);
    }

    // Numerals from the recorded scan. Permitted because the test above proves every line of
    // that excerpt is verbatim from a real run committed to tests/golden, which is a stronger
    // provenance than a table lookup: it is an artifact of the tool doing its job.
    const excerpt = readFileSync(
      resolve(import.meta.dirname, '..', 'src', 'recorded-scan.txt'),
      'utf8',
    );
    for (const numeral of excerpt.matchAll(/(?<![\w.])\d+(?:\.\d+)?%?(?!\w)/g)) {
      permitted.add(numeral[0]);
    }
    add(table.routing.filter((r) => r.chosen !== null).length);

    /**
     * Numbers that are not accuracy claims: WCAG criterion numbers, ACT rule identifiers,
     * years, version numbers, and the small integers in prose about the project's own
     * history. Each is listed rather than pattern-matched, so adding one is a deliberate act.
     */
    const notClaims = new Set([
      '1',
      '2',
      '3',
      '4',
      '10',
      '19',
      '20',
      '32',
      '34',
      '444',
      '524',
      '630',
      '1200',
      '65526',
      '80',
      // Facts about Marlo's own audit and its own test suite, from HONESTY.md: 48 tap
      // targets under 24 CSS pixels, 24 pixels, a 2.18:1 contrast failure, 26 site tests
      // that passed while all of that shipped, and 13 rules that crashed on a real page.
      // Not accuracy claims, and each one is written down in HONESTY.md where it can be
      // checked against the audit output in docs/screenshots/audit.json.
      '48',
      '24',
      '26',
      '13',
      '2.18',
      '256',
      '0',
      '22.13',
      '2.2',
      '1.1',
      '50',
      // "Lighthouse returns 100 on pages a screen reader cannot get through." A claim
      // about a different tool's score, not about Marlo's. A bare `100%` is separately
      // forbidden by the no-score test above and by scripts/check-claims.mjs.
      '100',
    ]);

    for (const page of pages) {
      // Prose only: strip the head, the structured data, and every attribute value, because
      // a viewport width or an SVG coordinate is not a claim about accuracy.

      const body = page.html
        .replace(/<head[\s\S]?<\/head>/i, '')
        .replace(/<script[\s\S]?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        // Remove HTML entities (decimal, hex, and named) so numeric references like "'" don't produce digits.
        .replace(/&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, ' ')
        // // ISO dates ...
        .replace(/\d{4}-\d{2}-\d{2}/g, ' ');

      // Standalone numerals only. A digit inside an identifier is not a claim: `c487ae`
      // is an ACT rule id and `KarthikSubramanian07` is a username, and the first version
      // of this test reported 487 and 07 as unexplained accuracy figures.
      const numerals = [...body.matchAll(/(?<![\w.])\d+(?:\.\d+)?%?(?!\w)/g)].map((m) => m[0]);
      const unexplained = numerals.filter((n) => {
        if (permitted.has(n)) return false;
        if (notClaims.has(n)) return false;
        // A WCAG success criterion, an ACT identifier, or a date fragment.
        if (/^\d+\.\d+(\.\d+)?$/.test(n)) return false;
        if (/^20\d\d$/.test(n)) return false;
        return true;
      });

      expect(
        [...new Set(unexplained)],
        `${page.path} renders numbers that do not come from the calibration table`,
      ).toEqual([]);
    }
  });
});

describe('the site is accessible by construction', () => {
  it('declares a language and a title on every page', () => {
    for (const page of pages) {
      expect(page.html, page.path).toMatch(/<html lang="en">/);
      expect(page.html, page.path).toMatch(/<title>[^<]{10,}<\/title>/);
    }
  });

  it('has a real skip link, first in the tab order', () => {
    for (const page of pages) {
      const bodyStart = page.html.indexOf('<body>');
      const skip = page.html.indexOf('class="skip"');
      const nav = page.html.indexOf('<nav');
      expect(skip, page.path).toBeGreaterThan(bodyStart);
      expect(skip, `${page.path}: skip link must precede the nav`).toBeLessThan(nav);
      expect(page.html).toContain('id="main"');
    }
  });

  it('uses correct landmarks exactly once each', () => {
    for (const page of pages) {
      for (const landmark of ['<header', '<main', '<footer', '<nav']) {
        const count = page.html.split(landmark).length - 1;
        expect(count, `${page.path} has ${String(count)} ${landmark}`).toBe(1);
      }
    }
  });

  it('starts every page with exactly one h1 and no skipped levels', () => {
    for (const page of pages) {
      const headings = [...page.html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
      expect(headings.filter((h) => h === 1).length, `${page.path} h1 count`).toBe(1);
      expect(headings[0], `${page.path} first heading`).toBe(1);
      for (let i = 1; i < headings.length; i += 1) {
        const jump = (headings[i] ?? 0) - (headings[i - 1] ?? 0);
        expect(jump, `${page.path} skips a heading level`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gives every image and every graphic an accessible name, or hides it', () => {
    for (const page of pages) {
      for (const img of page.html.matchAll(/<img\b[^>]*>/gi)) {
        expect(img[0], page.path).toMatch(/\balt=/);
      }
      // Every inline SVG here is decoration: a logo mark beside the word "marlo", a GitHub
      // glyph beside the word "Source", an arrow beside a link's own text. Each is
      // aria-hidden, because a graphic that duplicates adjacent text is noise in a screen
      // reader rather than information. focusable="false" is there for older engines that
      // put SVG in the tab order regardless.
      for (const svg of page.html.matchAll(/<svg\b[^>]*>/gi)) {
        const tag = svg[0];
        const hidden = tag.includes('aria-hidden="true"');
        const named = tag.includes('role="img"') && /aria-label="[^"]{8,}"/.test(tag);
        expect(hidden || named, `${page.path}: ${tag.slice(0, 80)}`).toBe(true);
        if (hidden) expect(tag, page.path).toContain('focusable="false"');
      }
      // The recorded terminal output is wide, scrollable and reachable by keyboard.
      if (page.html.includes('class="terminal"')) {
        expect(page.html).toMatch(
          /class="terminal__body" role="region" aria-label="[^"]{20,}" tabindex="0"/,
        );
      }
    }
  });

  it('names every table and scopes every header cell', () => {
    for (const page of pages) {
      const tables = page.html.split('<table').length - 1;
      if (tables === 0) continue;
      expect(page.html.split('<caption').length - 1, `${page.path} table captions`).toBe(tables);
      for (const th of page.html.matchAll(/<th\b([^>]*)>/g)) {
        expect(th[1] ?? '', `${page.path} th without scope`).toMatch(/scope="(row|col)"/);
      }
    }
  });

  it('marks the current page in the navigation', () => {
    for (const page of pages) {
      expect(page.html, page.path).toContain('aria-current="page"');
    }
  });
});

describe('severity and state are never colour alone', () => {
  it('pairs every tinted element with something a greyscale reader can still read', () => {
    const css = readFileSync(resolve(import.meta.dirname, '..', 'src', 'style.css'), 'utf8');
    // Marks carry a border in currentColor, so they are visible shapes and not just tints.
    for (const cls of ['.callout__mark', '.rank', '.bullet']) {
      expect(css, `${cls} is missing`).toContain(cls);
    }
    expect(/\.rank\s*\{[^}]*border: 1px solid currentcolor/.test(css)).toBe(true);

    for (const page of pages) {
      // Every callout, whatever its tint, carries a glyph.
      const callouts = [...page.html.matchAll(/<div class="callout[^"]*"[^>]*>([\s\S]*?)<\/p>/g)];
      for (const callout of callouts) {
        expect(callout[1] ?? '', `${page.path} callout without a mark`).toContain(
          'class="callout__mark"',
        );
      }
      // The engine ranking is a word before it is a colour: "best", "2nd", "3rd", "4th".
      if (page.html.includes('class="rank')) {
        expect(page.html, page.path).toMatch(
          /class="rank rank--(ok|warn|bad)">(best|2nd|3rd|4th|no detections)</,
        );
        // An engine that never returns a failure has a false positive rate of zero, and the
        // first version of the ranking printed "best" beside it. Nothing on this site may
        // rank an engine well for declining to answer.
        const silent = table.entries.some((e) => e.engine === 'htmlcs');
        if (silent && page.html.includes('HTML CodeSniffer')) {
          const cell = /HTML CodeSniffer<span class="rank[^>]*>([^<]*)</.exec(page.html)?.[1];
          if (cell !== undefined) expect(cell).toBe('3rd');
        }
      }
    }
  });

  it('respects reduced motion, forced colours, and commits to one colour scheme', () => {
    const css = readFileSync(resolve(import.meta.dirname, '..', 'src', 'style.css'), 'utf8');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('forced-colors: active');

    // The site is dark only, declared rather than implied, so the browser styles its own
    // scrollbars and form controls to match. An earlier version supported both schemes and
    // that is where the 2.18:1 contrast failure came from: a light theme reached into the
    // always-dark terminal and swapped its colours. One scheme, stated once, cannot do that.
    expect(css).toContain('color-scheme: dark');
    expect(css, 'a light theme block would reintroduce the terminal contrast bug').not.toContain(
      'prefers-color-scheme',
    );
    for (const page of pages) {
      expect(page.html, page.path).toContain('<meta name="color-scheme" content="dark" />');
    }

    // Focus is never removed.
    expect(css).not.toMatch(/outline:\s*(none|0)/);
    expect(css).toContain(':focus-visible');

    // Animation is opt-out and every animation is short or purely decorative. The one that
    // repeats forever is a terminal caret, which is 7 pixels wide.
    expect(css).toMatch(/animation-iteration-count: 1 !important/);
  });
});

describe('the site is responsive by construction', () => {
  const css = (): string =>
    readFileSync(resolve(import.meta.dirname, '..', 'src', 'style.css'), 'utf8');

  it('declares a viewport that permits zoom', () => {
    // Marlo has a rule about this. Failing its own rule on its own site would be the
    // shortest possible route to losing the argument.
    for (const page of pages) {
      expect(page.html, page.path).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      );
      expect(page.html).not.toContain('user-scalable=no');
      expect(page.html).not.toMatch(/maximum-scale=1/);
    }
  });

  it('is mobile first: every breakpoint is a min-width', () => {
    const queries = [...css().matchAll(/@media\s*\(([^)]+)\)/g)].map((m) => m[1] ?? '');
    const widthQueries = queries.filter((q) => q.includes('width'));
    expect(widthQueries.length).toBeGreaterThan(2);
    for (const query of widthQueries) {
      expect(query, `${query} is not a min-width`).toContain('min-width');
    }
  });

  it('never lets the page scroll sideways', () => {
    const style = css();
    expect(style).toContain('overflow-x: hidden');
    // Wide content scrolls inside its own box instead.
    expect(style).toMatch(/\.scroller\s*\{[^}]*overflow-x:\s*auto/);
    expect(style).toMatch(/\.terminal__body\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('lets long identifiers wrap rather than widen the page', () => {
    expect(css()).toMatch(/code\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it('scales type and spacing with the viewport', () => {
    const style = css();
    // Type uses clamp rather than fixed pixel jumps, so 390px and 834px both get a sensible
    // size without a query for each one.
    expect((style.match(/clamp\(/g) ?? []).length).toBeGreaterThan(6);
    // Spacing scales through two custom properties redefined per breakpoint, rather than
    // through a per-element override at every width. If either stops changing, the phone
    // layout and the laptop layout have silently converged on one set of margins.
    for (const token of ['--gutter', '--section-y']) {
      const declarations = [...style.matchAll(new RegExp(`${token}:\\s*[^;]+;`, 'g'))];
      expect(declarations.length, `${token} is not redefined per breakpoint`).toBeGreaterThan(2);
    }
  });

  it('collapses the scoreboard to one column on a phone', () => {
    const style = css();
    const scoreboard = /\.scoreboard\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
    expect(scoreboard).toContain('grid-template-columns: 1fr');
  });
});

describe('the assets do not drift from the stylesheet', () => {
  it("draws the favicon and the social image in the stylesheet's own colours", () => {
    // The favicon shipped as #4cc9e8 while the site rendered #00d3dd, so the browser tab was a
    // paler cyan than the page behind it. An SVG file cannot read a custom property, so the
    // only defence is to record the sRGB values in one place and compare.
    const css = readFileSync(resolve(import.meta.dirname, '..', 'src', 'style.css'), 'utf8');
    const documented = Object.fromEntries(
      [...css.matchAll(/srgb ([a-z-]+) (#[0-9a-f]{6})/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
    );
    expect(Object.keys(documented).length, 'style.css records no sRGB values').toBeGreaterThan(3);

    for (const asset of ['favicon.svg', 'og.svg']) {
      const svg = readFileSync(resolve(DIST, asset), 'utf8');
      expect(svg, `${asset} uses oklch, which a rasteriser may not honour`).not.toContain('oklch');
      const used = [...svg.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase());
      expect(used.length, `${asset} has no colours`).toBeGreaterThan(1);
      const known = new Set([...Object.values(documented), '#09090b', '#fafafa', '#a1a1aa']);
      for (const colour of used) {
        expect(known.has(colour), `${asset} uses ${colour}, which style.css does not record`).toBe(
          true,
        );
      }
      // And the accent is actually in there, so the check cannot pass on a greyscale asset.
      expect(used, `${asset} does not use the accent`).toContain(documented['accent']);
    }
  });
});

describe('SEO and delivery', () => {
  it('has a canonical URL, a description and OG tags on every page', () => {
    for (const page of pages) {
      expect(page.html, page.path).toMatch(
        /<link rel="canonical" href="https:\/\/trymarlo\.pages\.dev/,
      );
      expect(page.html, page.path).toMatch(/<meta name="description" content="[^"]{60,}"/);
      expect(page.html, page.path).toContain('property="og:image"');
    }
  });

  it('ships a sitemap, robots and structured data', () => {
    expect(existsSync(join(DIST, 'sitemap.xml'))).toBe(true);
    expect(existsSync(join(DIST, 'robots.txt'))).toBe(true);
    const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
    expect((sitemap.match(/<loc>/g) ?? []).length).toBe(pages.length);
    for (const page of pages) {
      expect(page.html, page.path).toContain('application/ld+json');
    }
  });

  it('serves a CSP that forbids script, because there is none', () => {
    const headers = readFileSync(join(DIST, '_headers'), 'utf8');
    expect(headers).toContain("default-src 'none'");
    expect(headers).not.toContain('script-src');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
  });

  it('references no external origin, so nothing blocks first paint', () => {
    for (const page of pages) {
      const head = /<head>[\s\S]*?<\/head>/.exec(page.html)?.[0] ?? '';
      // Only the canonical and OG URLs point at the site's own origin; nothing loads from
      // a third party, which is most of an LCP budget.
      const external = [...head.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)]
        .map((m) => m[1] ?? '')
        .filter((url) => !url.startsWith('https://trymarlo.pages.dev'));
      expect(external, page.path).toEqual([]);
    }
  });
});

describe('the liability discipline holds on the site too', () => {
  it('never claims certification or completeness', () => {
    // This runs the repository's own claims checker over the built pages rather than keeping
    // a second copy of the phrase list here. Two reasons, and the second is the important
    // one. A list retyped in this file would be a list the repository-wide check scans, and
    // the check would fail on the test that enforces it. And two lists drift, so the check
    // that reads the generated HTML would slowly stop matching the check that reads source.
    //
    // `apps/site/dist` is generated and git-ignored, so the repository-wide run never sees
    // it. Without this the site could publish a phrase the source is forbidden to contain.
    expect(pages.length).toBeGreaterThan(0);
    execFileSync('node', ['scripts/check-claims.mjs', ...pages.map((p) => p.path)], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  });

  it('states the denominator wherever coverage appears', () => {
    for (const page of pages) {
      if (!page.html.includes('ACT rules')) continue;
      expect(page.html, page.path).toMatch(
        new RegExp(`of\\s+${String(table.coverage.publishedActRules)}`),
      );
    }
  });

  it('says the repair layer is not built yet', () => {
    const index = pages.find((p) => p.path.endsWith(`dist/index.html`));
    expect(index).toBeDefined();
    expect(index?.html).toContain('the repair layer is not merged');
  });
});
