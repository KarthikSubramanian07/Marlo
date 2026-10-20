#!/usr/bin/env node
/**
 * Snapshots real web pages into corpus/real/pages/, one directory per page.
 *
 * The ACT corpus is hand-written and minimal: one condition per document. Real pages are
 * deep, carry framework markup, and load stylesheets that change what is visible, and
 * nothing in this repository measured Marlo against one before this corpus existed. The
 * page list lives in corpus/real/SOURCES.json, and every entry there names the licence
 * that permits vendoring a modified copy, because inlining CSS is a modification.
 *
 * What a snapshot is, exactly, so a reader can judge what the measurement rests on:
 *
 *   - Chromium, 1280 by 800, the page loaded until the network is idle. Optional
 *     `actions` (click, fill, goto) run first for pages that need state, such as a
 *     checkout with something in the cart.
 *   - Every stylesheet that loaded, same-origin or cross-origin, is inlined into a
 *     `<style>` element in document order, with `@import` chased and `url()` references
 *     made absolute. `@font-face` rules are kept; the fonts will not load offline and
 *     that is fine, because no rule Marlo claims reads a glyph.
 *   - Every `<script>` element and every `on*` attribute is removed, and the count is
 *     recorded. The DOM is serialised after scripts ran in Chromium, so a single-page
 *     application's rendered shell is what gets kept.
 *   - `img`, `source`, `video`, `iframe` and `link rel=icon` URLs are rewritten to
 *     absolute, so they are inert offline but still inspectable.
 *   - The original doctype is prepended, then a one-line provenance comment, then
 *     `document.documentElement.outerHTML`.
 *
 * Deterministic apart from the page itself: no timestamps finer than a date, no random
 * identifiers, stable ordering.
 *
 * Playwright is deliberately not a dependency of this repository. Install it for this
 * script only:
 *
 *   pnpm add -D -w playwright@1.62.0 && pnpm exec playwright install chromium
 *
 * and do not commit the package.json and lockfile changes that makes.
 *
 * Usage:
 *   node scripts/snapshot-real-pages.mjs              snapshot every page, rebuild MANIFEST.json
 *   node scripts/snapshot-real-pages.mjs --only <id>  snapshot one page, rebuild MANIFEST.json
 *   node scripts/snapshot-real-pages.mjs --manifest   rebuild MANIFEST.json from disk only
 *   ... --corpus heldout                              any of the above, on corpus/heldout
 *
 * corpus/heldout is a second set of pages from different sites, snapshotted the same way,
 * whose ground truth was committed before any rule change made after the error analysis
 * on corpus/real was measured on it.
 *
 * Needs network. Everything else in this repository does not.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { hygieneProblems } from './lib/snapshot-hygiene.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const corpusAt = argv.indexOf('--corpus');
const CORPUS = corpusAt === -1 ? 'real' : argv[corpusAt + 1];
if (CORPUS !== 'real' && CORPUS !== 'heldout') {
  throw new Error(`--corpus must be real or heldout, not "${String(CORPUS)}"`);
}
const REAL = join(ROOT, 'corpus', CORPUS);
const PAGES = join(REAL, 'pages');
const SOURCES = join(REAL, 'SOURCES.json');
const MANIFEST = join(REAL, 'MANIFEST.json');

const manifestOnly = argv.includes('--manifest');
const onlyIndex = argv.indexOf('--only');
const only = onlyIndex === -1 ? null : argv[onlyIndex + 1];

/** Bounds. A page that needs more than these is a page this corpus does not want. */
const NAVIGATION_TIMEOUT_MS = 60_000;
const NETWORK_IDLE_TIMEOUT_MS = 30_000;
const MAX_STYLESHEETS = 80;
const MAX_IMPORT_DEPTH = 4;
const MAX_STYLESHEET_BYTES = 2 * 1024 * 1024;
const MAX_PAGE_BYTES = 6 * 1024 * 1024;
const VIEWPORT = { width: 1280, height: 800 };

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readSources() {
  const parsed = JSON.parse(readFileSync(SOURCES, 'utf8'));
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error(`corpus/${CORPUS}/SOURCES.json has no pages`);
  }
  const ids = new Set();
  for (const page of parsed.pages) {
    for (const key of ['id', 'category', 'url']) {
      if (typeof page[key] !== 'string' || page[key] === '') {
        throw new Error(`SOURCES.json: a page is missing "${key}"`);
      }
    }
    if (!/^[a-z]+-\d{2}$/.test(page.id)) {
      throw new Error(`SOURCES.json: id "${page.id}" is not <category>-<nn>`);
    }
    if (ids.has(page.id)) throw new Error(`SOURCES.json: duplicate id "${page.id}"`);
    ids.add(page.id);
    if (
      typeof page.licence?.name !== 'string' ||
      typeof page.licence?.url !== 'string' ||
      typeof page.licence?.attribution !== 'string'
    ) {
      throw new Error(
        `SOURCES.json: "${page.id}" needs licence.name, licence.url and licence.attribution`,
      );
    }
  }
  return parsed.pages;
}

/**
 * Makes every url() and @import target in a stylesheet absolute against the sheet's own
 * URL, so a reader can follow a reference from the snapshot and the browser cannot
 * accidentally resolve one against the file system.
 */
function absolutiseCss(css, baseUrl) {
  const abs = (ref) => {
    const trimmed = ref.trim();
    if (trimmed === '' || /^(data|blob|about):/i.test(trimmed) || trimmed.startsWith('#')) {
      return trimmed;
    }
    try {
      return new URL(trimmed, baseUrl).href;
    } catch {
      return trimmed;
    }
  };
  return css
    .replace(
      /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
      (_, quote, ref) => `url(${quote}${abs(ref)}${quote})`,
    )
    .replace(
      /@import\s+(["'])([^"']+)\1/gi,
      (_, quote, ref) => `@import ${quote}${abs(ref)}${quote}`,
    );
}

/**
 * Fetches a stylesheet through the page's own request context, so cookies and referer
 * match what the browser sent, and chases @import up to a bounded depth.
 */
async function fetchStylesheet(page, href, depth, seen) {
  if (depth > MAX_IMPORT_DEPTH || seen.size >= MAX_STYLESHEETS) return `/* skipped: ${href} */`;
  if (seen.has(href)) return `/* already inlined: ${href} */`;
  seen.add(href);

  let css;
  try {
    const response = await page.request.get(href, { timeout: 20_000 });
    if (!response.ok()) return `/* ${String(response.status())} fetching ${href} */`;
    css = await response.text();
  } catch (error) {
    return `/* failed to fetch ${href}: ${error instanceof Error ? error.message : String(error)} */`;
  }
  if (css.length > MAX_STYLESHEET_BYTES) return `/* stylesheet over size cap: ${href} */`;

  css = absolutiseCss(css, href);

  // @import lines are replaced inline, in place, so cascade order is preserved.
  const imports = [
    ...css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?([^;]*);/gi),
  ];
  for (const match of imports) {
    const nested = await fetchStylesheet(page, match[1], depth + 1, seen);
    const media = match[2].trim();
    css = css.replace(match[0], media === '' ? nested : `@media ${media} {\n${nested}\n}`);
  }
  return css;
}

/**
 * Runs the pre-snapshot actions an entry declares. Kept tiny on purpose: a page that
 * needs more than a few clicks to reach is a page whose snapshot nobody could reproduce.
 */
async function runActions(page, actions) {
  for (const action of actions) {
    if (typeof action.goto === 'string') {
      await page.goto(action.goto, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } else if (typeof action.click === 'string') {
      await page.locator(action.click).first().click({ timeout: 20_000 });
    } else if (Array.isArray(action.fill)) {
      await page.locator(action.fill[0]).first().fill(action.fill[1], { timeout: 20_000 });
    } else if (typeof action.waitFor === 'string') {
      await page.locator(action.waitFor).first().waitFor({ timeout: 20_000 });
    } else if (typeof action.waitForUrl === 'string') {
      // A click that submits a form navigates on its own. Navigating again while that
      // is in flight aborts both, so the entry waits for the page to land first.
      await page.waitForURL(action.waitForUrl, { timeout: NAVIGATION_TIMEOUT_MS });
    } else {
      throw new Error(`unknown action ${JSON.stringify(action)}`);
    }
    await settle(page);
  }
}

async function settle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS });
  } catch {
    // A page with a long-polling connection never goes idle. The load event is enough.
    await page.waitForLoadState('load', { timeout: NETWORK_IDLE_TIMEOUT_MS });
  }
}

/**
 * Collects the stylesheets in document order. Done in the page so the order is the
 * cascade order, and returned as a plan the Node side fulfils.
 */
async function stylesheetPlan(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('link[rel~="stylesheet"][href], style')];
    return nodes.map((node, index) => {
      node.setAttribute('data-marlo-sheet', String(index));
      if (node.tagName === 'LINK') {
        return { index, kind: 'link', href: node.href, media: node.getAttribute('media') ?? '' };
      }
      // A <style> element a framework filled through insertRule has an empty text node
      // and a populated sheet. Serialising the sheet keeps what the user saw.
      let text = node.textContent ?? '';
      if (text.trim() === '' && node.sheet) {
        try {
          text = [...node.sheet.cssRules].map((rule) => rule.cssText).join('\n');
        } catch {
          text = '';
        }
      }
      return { index, kind: 'style', text, media: node.getAttribute('media') ?? '' };
    });
  });
}

async function snapshot(browser, entry, retrieved) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    await settle(page);
    await runActions(page, entry.actions ?? []);

    const doctype = await page.evaluate(() => {
      const dt = document.doctype;
      if (!dt) return '';
      const pub = dt.publicId ? ` PUBLIC "${dt.publicId}"` : '';
      const sys = dt.systemId ? `${dt.publicId ? '' : ' SYSTEM'} "${dt.systemId}"` : '';
      return `<!DOCTYPE ${dt.name}${pub}${sys}>`;
    });

    // Stylesheets, in cascade order.
    const plan = await stylesheetPlan(page);
    const seen = new Set();
    const inlined = [];
    for (const item of plan.slice(0, MAX_STYLESHEETS)) {
      if (item.kind === 'link') {
        inlined.push({
          index: item.index,
          media: item.media,
          href: item.href,
          css: await fetchStylesheet(page, item.href, 0, seen),
        });
      } else {
        inlined.push({
          index: item.index,
          media: item.media,
          href: null,
          css: absolutiseCss(item.text, page.url()),
        });
      }
    }

    const result = await page.evaluate(
      ({ sheets, pageUrl }) => {
        // 1. Inline stylesheets.
        for (const sheet of sheets) {
          const node = document.querySelector(`[data-marlo-sheet="${String(sheet.index)}"]`);
          if (!node) continue;
          const style = document.createElement('style');
          if (sheet.media) style.setAttribute('media', sheet.media);
          if (sheet.href) style.setAttribute('data-marlo-inlined-from', sheet.href);
          style.textContent = sheet.css;
          node.replaceWith(style);
        }
        for (const node of document.querySelectorAll('[data-marlo-sheet]')) {
          node.removeAttribute('data-marlo-sheet');
        }

        // 2. Remove scripts and inline handlers. Counted, because the count is provenance.
        // Through the prototype rather than `element.remove()`. One page's loader
        // overrode removal on its own script elements, and seven survived the first
        // version of this pass and were serialised. The string-level pass after
        // serialisation catches anything that survives even this.
        let scriptsRemoved = 0;
        const removeChild = Node.prototype.removeChild;
        for (const script of [...document.querySelectorAll('script')]) {
          if (script.parentNode) removeChild.call(script.parentNode, script);
          if (!script.isConnected) scriptsRemoved += 1;
        }
        let handlersRemoved = 0;
        for (const element of document.querySelectorAll('*')) {
          for (const attribute of [...element.attributes]) {
            if (/^on[a-z]/i.test(attribute.name)) {
              element.removeAttribute(attribute.name);
              handlersRemoved += 1;
            }
          }
        }

        // 3. Absolute URLs for media and frames.
        const absolutise = (element, attribute) => {
          const value = element.getAttribute(attribute);
          if (value === null || value.trim() === '' || /^(data|blob):/i.test(value.trim())) return;
          try {
            element.setAttribute(attribute, new URL(value, pageUrl).href);
          } catch {
            // Leave an unparseable value as it was. It is part of the page.
          }
        };
        const absolutiseSrcset = (element) => {
          const value = element.getAttribute('srcset');
          if (value === null) return;
          const rewritten = value
            .split(',')
            .map((candidate) => {
              const [url, ...descriptor] = candidate.trim().split(/\s+/);
              if (!url) return candidate;
              try {
                return [new URL(url, pageUrl).href, ...descriptor].join(' ');
              } catch {
                return candidate;
              }
            })
            .join(', ');
          element.setAttribute('srcset', rewritten);
        };
        for (const img of document.querySelectorAll('img')) {
          absolutise(img, 'src');
          absolutiseSrcset(img);
        }
        for (const source of document.querySelectorAll('source')) {
          absolutise(source, 'src');
          absolutiseSrcset(source);
        }
        for (const video of document.querySelectorAll('video')) {
          absolutise(video, 'src');
          absolutise(video, 'poster');
        }
        for (const frame of document.querySelectorAll('iframe')) absolutise(frame, 'src');
        for (const icon of document.querySelectorAll(
          'link[rel~="icon"], link[rel="apple-touch-icon"]',
        )) {
          absolutise(icon, 'href');
        }

        return {
          scriptsRemoved,
          handlersRemoved,
          title: document.title,
          html: document.documentElement.outerHTML,
        };
      },
      { sheets: inlined, pageUrl: page.url() },
    );

    // Anything that survived the DOM pass is removed from the serialised text. A script
    // element's content cannot contain its own end tag, so the pattern is exact.
    let survivors = 0;
    result.html = result.html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, () => {
      survivors += 1;
      return '';
    });
    result.scriptsRemoved += survivors;

    const provenance =
      `<!-- marlo-snapshot: url ${entry.url}; retrieved ${retrieved}; ` +
      `licence ${entry.licence.name} (${entry.licence.url}); ` +
      `scripts removed ${String(result.scriptsRemoved)}; ` +
      `inline handlers removed ${String(result.handlersRemoved)}; ` +
      `stylesheets inlined ${String(inlined.length)}; ` +
      `viewport ${String(VIEWPORT.width)}x${String(VIEWPORT.height)}` +
      `${page.url() === entry.url ? '' : `; landed ${page.url()}`} -->`;

    const document = `${doctype === '' ? '' : `${doctype}\n`}${provenance}\n${result.html}\n`;
    // The verifier's own check, before anything is written. A page that would fail
    // `corpus:verify` is never vendored, whatever the passes above missed.
    const unclean = hygieneProblems(entry.id, document);
    if (unclean.length > 0) throw new Error(unclean.join(' '));
    const bytes = Buffer.from(document, 'utf8');
    if (bytes.length > MAX_PAGE_BYTES) {
      throw new Error(
        `${entry.id}: ${String(bytes.length)} bytes is over the ${String(MAX_PAGE_BYTES)} byte cap`,
      );
    }
    return {
      bytes,
      title: result.title,
      scriptsRemoved: result.scriptsRemoved,
      finalUrl: page.url(),
    };
  } finally {
    await context.close();
  }
}

/** Reads the provenance line back out of a snapshot. The file is its own record. */
function readProvenance(html) {
  const m =
    /<!-- marlo-snapshot: url (\S+); retrieved (\d{4}-\d{2}-\d{2}); .*?scripts removed (\d+);.*?(?:; landed (\S+))? -->/.exec(
      html,
    );
  if (!m) return null;
  return { url: m[1], retrieved: m[2], scriptsRemoved: Number(m[3]), landed: m[4] ?? null };
}

function readTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/**
 * Builds MANIFEST.json from the files on disk and SOURCES.json. Nothing is carried over
 * from a previous manifest: every digest, size and count is recomputed, so the manifest
 * can only describe what is actually there.
 */
function writeManifest(sources) {
  const onDisk = existsSync(PAGES)
    ? readdirSync(PAGES, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];
  const byId = new Map(sources.map((s) => [s.id, s]));

  const pages = [];
  for (const id of onDisk) {
    const source = byId.get(id);
    if (source === undefined) {
      throw new Error(`corpus/${CORPUS}/pages/${id} is on disk but not in SOURCES.json`);
    }
    const file = join(PAGES, id, 'index.html');
    if (!existsSync(file)) throw new Error(`corpus/${CORPUS}/pages/${id}/index.html is missing`);
    const bytes = readFileSync(file);
    const html = bytes.toString('utf8');
    const provenance = readProvenance(html);
    if (provenance === null) throw new Error(`${id}: no marlo-snapshot provenance comment`);
    if (provenance.url !== source.url) {
      throw new Error(`${id}: snapshot says ${provenance.url}, SOURCES.json says ${source.url}`);
    }
    pages.push({
      id,
      category: source.category,
      url: source.url,
      ...(provenance.landed === null ? {} : { landedUrl: provenance.landed }),
      retrieved: provenance.retrieved,
      licence: { name: source.licence.name, url: source.licence.url },
      title: readTitle(html),
      path: `pages/${id}/index.html`,
      sha256: sha256(bytes),
      bytes: bytes.length,
      scriptsRemoved: provenance.scriptsRemoved,
    });
  }

  const categories = {};
  for (const page of pages) categories[page.category] = (categories[page.category] ?? 0) + 1;

  const manifest = {
    source: {
      name: 'Real pages, snapshotted from the public web',
      sourcesFile: 'SOURCES.json',
      notice: 'NOTICE.md',
      identification:
        'Published tables name a page by category and the first twelve hex digits of its ' +
        'SHA-256. The source URL for each is in this file.',
    },
    retrieved: pages.reduce((latest, p) => (p.retrieved > latest ? p.retrieved : latest), ''),
    totals: {
      pages: pages.length,
      bytes: pages.reduce((sum, p) => sum + p.bytes, 0),
      scriptsRemoved: pages.reduce((sum, p) => sum + p.scriptsRemoved, 0),
      categories: Object.fromEntries(
        Object.entries(categories).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    pages,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

const sources = readSources();

if (!manifestOnly) {
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error(
      'Playwright is not installed. Run:\n' +
        '  pnpm add -D -w playwright@1.62.0 && pnpm exec playwright install chromium\n' +
        'and do not commit the package.json and lockfile changes.',
    );
    process.exitCode = 1;
  }

  if (chromium !== undefined) {
    const retrieved = new Date().toISOString().slice(0, 10);
    const selected = only === null ? sources : sources.filter((s) => s.id === only);
    if (selected.length === 0) throw new Error(`no page with id "${String(only)}" in SOURCES.json`);

    const browser = await chromium.launch();
    const failures = [];
    try {
      for (const entry of selected) {
        process.stdout.write(`${entry.id.padEnd(18)} ${entry.url}\n`);
        try {
          const shot = await snapshot(browser, entry, retrieved);
          const dir = join(PAGES, entry.id);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'index.html'), shot.bytes);
          process.stdout.write(
            `${''.padEnd(18)} ${String(shot.bytes.length).padStart(8)} bytes, ` +
              `${String(shot.scriptsRemoved)} scripts removed, "${shot.title.slice(0, 60)}"` +
              `${shot.finalUrl !== entry.url ? ` (landed on ${shot.finalUrl})` : ''}\n`,
          );
        } catch (error) {
          failures.push({ id: entry.id, error });
          process.stdout.write(
            `${''.padEnd(18)} FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }
    } finally {
      await browser.close();
    }
    if (failures.length > 0) {
      console.error(
        `\n${String(failures.length)} page(s) failed to snapshot: ${failures.map((f) => f.id).join(', ')}`,
      );
      process.exitCode = 1;
    }
  }
}

const manifest = writeManifest(sources);
console.log(
  `\nMANIFEST.json: ${String(manifest.totals.pages)} pages, ` +
    `${String(Math.round(manifest.totals.bytes / 1024))} KiB, ` +
    `${String(manifest.totals.scriptsRemoved)} scripts removed.`,
);
