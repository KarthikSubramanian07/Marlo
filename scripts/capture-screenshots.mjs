#!/usr/bin/env node
/**
 * Screenshots every site surface at the three widths the layout is designed for, and runs
 * axe-core against each page while the browser is already open.
 *
 * The widths are named devices rather than round numbers, because "does it work on mobile"
 * is not a question anyone can check. 390 is an iPhone 15/16 in portrait, 834 is an iPad in
 * portrait, 1440 is a laptop. If a layout is broken it will be broken at one of those.
 *
 * The accessibility audit is here rather than in a separate script for one reason: the
 * browser is already running, and a dogfooding check that costs a second run is a check
 * somebody eventually skips. Marlo's own surfaces have to pass Marlo's own bar, and this is
 * where that is proved rather than asserted.
 *
 * Usage: node scripts/capture-screenshots.mjs [--open]
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'apps/site/dist');
const SHOTS = resolve(ROOT, 'docs/screenshots');

/** The three widths, named so the intent survives. */
const VIEWPORTS = [
  { name: 'iphone', width: 390, height: 844, scale: 3, label: 'iPhone portrait' },
  { name: 'ipad', width: 834, height: 1112, scale: 2, label: 'iPad portrait' },
  { name: 'desktop', width: 1440, height: 900, scale: 2, label: 'Laptop' },
];

const PAGES = [
  { slug: 'home', path: 'index.html' },
  { slug: 'accuracy', path: 'accuracy/index.html' },
  { slug: 'rules', path: 'rules/index.html' },
  { slug: 'method', path: 'method/index.html' },
  { slug: 'honesty', path: 'honesty/index.html' },
];

/**
 * Serves apps/site/dist over HTTP.
 *
 * The first version opened the pages as file:// URLs, and every absolute asset path
 * resolved against the filesystem root, so the stylesheet never loaded. axe then reported
 * 56 contrast failures that were really the browser's default link colour on white, and the
 * screenshots were of an unstyled page. A local server costs six lines and removes a whole
 * class of false result.
 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

function serve(root) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let file = join(root, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = join(file, 'index.html');
    try {
      const body = readFileSync(file);
      response.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((ready) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      ready({
        server,
        origin: `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`,
      });
    });
  });
}

let chromium;
try {
  const specifier = 'playwright';
  const playwright = await import(specifier);
  chromium = playwright.chromium;
} catch {
  console.error(
    'Screenshots need Playwright:\n  pnpm add -D playwright && pnpm exec playwright install chromium',
  );
  process.exitCode = 2;
}

if (chromium !== undefined) {
  mkdirSync(SHOTS, { recursive: true });

  const axeSource = readFileSync(
    require.resolve('axe-core', { paths: [resolve(ROOT, 'packages/engines')] }),
    'utf8',
  );

  const { server, origin } = await serve(DIST);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const findings = [];
  let widest = 0;

  for (const viewport of VIEWPORTS) {
    for (const scheme of ['dark', 'light']) {
      // Both schemes, because the site declares support for both and a contrast bug in the
      // one nobody screenshots is a contrast bug that ships.
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.scale,
        colorScheme: scheme,
        reducedMotion: 'reduce',
      });

      for (const page of PAGES) {
        const tab = await context.newPage();
        await tab.goto(`${origin}/${page.path}`, { waitUntil: 'load' });
        // The stylesheet has to have actually arrived, or every contrast result is a
        // measurement of the browser default.
        const styled = await tab.evaluate(() => getComputedStyle(document.body).backgroundColor);
        if (styled === 'rgba(0, 0, 0, 0)' || styled === 'rgb(255, 255, 255)') {
          throw new Error(
            `${page.slug}: the stylesheet did not load, so nothing here is measurable`,
          );
        }

        // Horizontal overflow is the single most common responsive defect and the easiest
        // to miss on a desktop. Measured rather than eyeballed.
        const overflow = await tab.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 1) {
          findings.push({
            page: page.slug,
            viewport: viewport.name,
            scheme,
            kind: 'horizontal-overflow',
            detail: `${String(overflow)}px wider than the viewport`,
          });
        }
        widest = Math.max(widest, overflow);

        // Tap targets. WCAG 2.2 asks for 24 by 24 CSS pixels on 2.5.8, and a phone is where
        // that actually bites.
        if (viewport.name === 'iphone') {
          const small = await tab.evaluate(() => {
            const out = [];
            for (const el of document.querySelectorAll('a, button')) {
              const box = el.getBoundingClientRect();
              if (box.width === 0 && box.height === 0) continue;
              // WCAG 2.2 success criterion 2.5.8 exempts a link that is inline in a
              // sentence, because enlarging it would break the line. The first version of
              // this check was stricter than the criterion and flagged every link in a
              // paragraph, which is noise rather than a finding.
              const parent = el.parentElement;
              const inlineInText =
                parent !== null &&
                ['P', 'LI', 'SPAN', 'STRONG', 'EM', 'CAPTION', 'TD'].includes(parent.tagName);
              if (inlineInText) continue;
              if (box.width < 24 || box.height < 24) {
                out.push(
                  `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`,
                );
              }
            }
            return out;
          });
          for (const detail of small) {
            findings.push({
              page: page.slug,
              viewport: viewport.name,
              scheme,
              kind: 'tap-target-under-24px',
              detail,
            });
          }
        }

        // Marlo's own bar, applied to Marlo's own site, in a real browser with real layout,
        // which is the only place contrast can honestly be checked.
        await tab.addScriptTag({ content: axeSource });
        const result = await tab.evaluate(
          async () =>
            await window.axe.run(document, {
              resultTypes: ['violations'],
              runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
              },
            }),
        );
        for (const violation of result.violations) {
          if (violation.impact !== 'critical' && violation.impact !== 'serious') continue;
          findings.push({
            page: page.slug,
            viewport: viewport.name,
            scheme,
            kind: `axe:${violation.id}`,
            detail: `${violation.impact}: ${violation.help} (${String(violation.nodes.length)} nodes)`,
          });
        }

        if (scheme === 'dark') {
          await tab.screenshot({
            path: resolve(SHOTS, `${page.slug}-${viewport.name}.png`),
            fullPage: true,
          });
        } else if (page.slug === 'home' || page.slug === 'accuracy') {
          await tab.screenshot({
            path: resolve(SHOTS, `${page.slug}-${viewport.name}-light.png`),
            fullPage: true,
          });
        }

        await tab.close();
      }
      await context.close();
    }
  }

  // The focus-visible state, which is a requirement and is invisible in a normal capture.
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    const tab = await context.newPage();
    await tab.goto(`${origin}/index.html`);
    await tab.keyboard.press('Tab');
    await tab.screenshot({ path: resolve(SHOTS, 'home-skip-link-focused.png') });
    await tab.keyboard.press('Tab');
    await tab.keyboard.press('Tab');
    await tab.screenshot({ path: resolve(SHOTS, 'home-nav-focused.png') });
    await tab.close();
    await context.close();
  }

  await browser.close();
  server.close();

  writeFileSync(
    resolve(SHOTS, 'audit.json'),
    `${JSON.stringify({ widestOverflowPx: widest, findings }, null, 2)}\n`,
    'utf8',
  );

  console.log(
    `screenshots: ${String(PAGES.length * VIEWPORTS.length + 2)} captures at ` +
      `${VIEWPORTS.map((v) => `${String(v.width)}px`).join(', ')}`,
  );
  console.log(`  widest horizontal overflow: ${String(widest)}px`);

  if (findings.length > 0) {
    console.error(`\n${String(findings.length)} problems on Marlo's own site:\n`);
    for (const finding of findings) {
      console.error(
        `  ${finding.page} @ ${finding.viewport}/${finding.scheme}  ${finding.kind}\n    ${finding.detail}`,
      );
    }
    console.error(
      '\nDogfooding is a hard gate. Marlo has no standing to report a violation it ships.\n',
    );
    process.exitCode = 1;
  } else {
    console.log('  no critical or serious axe violations, no overflow, no small tap targets');
  }
}
