#!/usr/bin/env node
/**
 * Grades the contrast rules against their official test cases in a real browser.
 *
 * WHY THIS EXISTS
 *
 * The paint-order walk in packages/rules/src/paint.ts is developed against hand-built
 * fixtures, because @marlo/rules is pure. A fixture carries the computed styles its
 * author believes a browser resolves, and the author can be wrong in exactly the way
 * that matters: a value that looks right and is not. This script removes the author
 * from the loop. It loads each afw4f7 and 09o5cg test case in Chromium, reads the
 * computed properties the walk consumes plus every element's box, hands them to
 * `buildDocument` the way a layout-capable renderer would, evaluates the two rules,
 * and grades the answers with the same strict protocol the calibration table uses.
 *
 * It is a developer tool. It is not wired into `pnpm check`, because `pnpm check` runs
 * with no browser, and the numbers it prints are evidence for a pull request rather
 * than a published figure. The calibration harness remains the only source of
 * published numbers.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not tune anything. A case that comes back wrong is either a defect in the
 * walk, which gets fixed in the walk, or something the browser computes that the walk
 * cannot see, which gets a `cantTell` with a reason. Reading the output as a target to
 * hit would reproduce the harness filter in AGENTS.md that lifted precision to 1.00 by
 * skipping the hard cases.
 *
 * Usage:
 *   pnpm build
 *   pnpm add -D -w playwright@1.62.0 && pnpm exec playwright install chromium
 *   node scripts/measure-contrast-fixtures.mjs [--rule afw4f7] [--verbose]
 *
 * Then `git checkout -- package.json pnpm-lock.yaml`, because Playwright is an optional
 * dependency and must stay one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const RULES = ['afw4f7', '09o5cg'];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const onlyRule = arg('rule');
const verbose = process.argv.includes('--verbose');

/**
 * The computed properties the walk reads. Listed here rather than copying every
 * property, so the script states exactly what the walk is allowed to see and a reader
 * can check it against paint.ts.
 */
const PROPERTIES = [
  'color',
  'background-color',
  'background-image',
  'opacity',
  'display',
  'visibility',
  'position',
  'transform',
  'float',
  'font-size',
  'font-weight',
  'text-shadow',
  'mix-blend-mode',
  'filter',
  'backdrop-filter',
  '-webkit-text-fill-color',
  '-webkit-text-stroke-width',
  'direction',
  'color-scheme',
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'Playwright is not installed. Run: pnpm add -D -w playwright@1.62.0 && pnpm exec playwright install chromium',
  );
  process.exitCode = 2;
}

if (chromium !== undefined) {
  const { buildDocument, evaluateRules } = await import('@marlo/rules');
  const { strictAccuracyOf, isAllowed, consistencyOf } = await import('@marlo/act');

  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'corpus/act/MANIFEST.json'), 'utf8'));
  const cases = manifest.testCases.filter(
    (t) => RULES.includes(t.ruleId) && (onlyRule === undefined || t.ruleId === onlyRule),
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  /**
   * Serialises the composed tree with the computed styles and boxes attached. Runs in
   * the page. A shadow root's children stand in for the host's, because the flat tree is
   * what the browser paints and what the ACT rule is written against; the four shadow
   * DOM cases are only measurable this way.
   */
  const extract = (properties) => {
    const serialise = (node) => {
      if (node.nodeType === 3) return { nodeType: 3, nodeName: '#text', text: node.data };
      if (node.nodeType !== 1) return null;
      const style = getComputedStyle(node);
      const computed = {};
      for (const property of properties) computed[property] = style.getPropertyValue(property);
      const rect = node.getBoundingClientRect();
      const source = node.shadowRoot ?? node;
      const children = [];
      for (const child of source.childNodes) {
        const converted = serialise(child);
        if (converted !== null) children.push(converted);
      }
      return {
        nodeType: 1,
        nodeName: node.nodeName,
        attributes: Array.from(node.attributes, (a) => ({ name: a.name, value: a.value })),
        outerHTML: node.outerHTML.length > 2000 ? node.outerHTML.slice(0, 2000) : node.outerHTML,
        textContent: node.textContent,
        computed,
        box: {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          width: rect.width,
          height: rect.height,
        },
        children,
      };
    };
    return { root: serialise(document.documentElement), hasDoctype: document.doctype !== null };
  };

  /** Turns the serialised tree into SourceElements with side tables for styles and boxes. */
  function toSource(node, styles, boxes) {
    if (node.nodeType === 3) {
      return { nodeType: 3, nodeName: '#text', childNodes: [], textContent: node.text };
    }
    const element = {
      nodeType: 1,
      nodeName: node.nodeName,
      attributes: node.attributes,
      outerHTML: node.outerHTML,
      textContent: node.textContent,
      childNodes: [],
    };
    element.childNodes = node.children.map((c) => toSource(c, styles, boxes));
    styles.set(element, node.computed);
    boxes.set(element, node.box);
    return element;
  }

  const rows = [];
  for (const testCase of cases) {
    const page = await context.newPage();
    const file = resolve(ROOT, 'corpus/act', testCase.path);
    // The test assets referenced by the image cases are not vendored. A failed image
    // load leaves `background-image` as the url, which is all the walk needs to decline.
    await page.route('**/test-assets/**', (route) => route.abort());
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    const extracted = await page.evaluate(extract, PROPERTIES);
    await page.close();

    const styles = new WeakMap();
    const boxes = new WeakMap();
    const root = toSource(extracted.root, styles, boxes);
    const document = buildDocument(root, {
      url: pathToFileURL(file).href,
      hasDoctype: extracted.hasDoctype,
      computedStyleFor: (element) => {
        const computed = styles.get(element);
        return { get: (property) => computed?.[property] ?? null };
      },
      boxFor: (element) => boxes.get(element) ?? null,
    });

    const report = evaluateRules([testCase.ruleId], {
      document,
      renderer: 'browser',
      capabilities: new Set(['dom', 'script', 'layout', 'paint']),
      version: 'measure',
    });
    const result = report.results[0];
    let actual = null;
    let detail = '';
    if (result.status === 'ok') {
      const outcomes = result.verdicts.map((v) => v.outcome);
      if (outcomes.length === 0) actual = 'inapplicable';
      else if (outcomes.includes('failed')) actual = 'failed';
      else if (outcomes.includes('cantTell')) actual = 'cantTell';
      else actual = 'passed';
      detail = result.verdicts.map((v) => `${v.target.selector}: ${v.message}`).join(' | ');
    } else {
      detail = result.error ?? result.status;
    }
    rows.push({
      rule: testCase.ruleId,
      id: testCase.testcaseId.slice(0, 8),
      title: testCase.title,
      expected: testCase.expected,
      actual,
      errored: result.status === 'error',
      allowed: isAllowed(testCase.expected, actual),
      detail,
    });
  }

  await context.close();
  await browser.close();

  const pad = (text, width) => String(text).padEnd(width);
  console.log(
    `${pad('rule', 7)}${pad('case', 10)}${pad('title', 24)}${pad('expected', 14)}${pad('marlo', 14)}ok`,
  );
  for (const row of rows) {
    console.log(
      `${pad(row.rule, 7)}${pad(row.id, 10)}${pad(row.title, 24)}${pad(row.expected, 14)}${pad(
        row.actual ?? 'error',
        14,
      )}${row.allowed ? 'yes' : 'NO'}`,
    );
    if (verbose || !row.allowed || row.actual === 'cantTell') {
      console.log(`        ${row.detail}`);
    }
  }

  console.log('');
  for (const rule of RULES) {
    const graded = rows
      .filter((r) => r.rule === rule)
      .map((r) => ({ expected: r.expected, actual: r.actual, errored: r.errored }));
    if (graded.length === 0) continue;
    const strict = strictAccuracyOf(graded);
    const fmt = (n) => (n === null ? 'n/a' : n.toFixed(3));
    console.log(
      `${rule}: protocol ${consistencyOf(graded)}; strict precision ${fmt(strict.precision)}, ` +
        `recall ${fmt(strict.recall)}, tp ${strict.truePositives} fp ${strict.falsePositives} ` +
        `fn ${strict.falseNegatives} tn ${strict.trueNegatives}, cantTell on failed ` +
        `${strict.cantTellOnFailed}, cantTell on passed ${strict.cantTellOnPassed}`,
    );
  }

  if (rows.some((r) => !r.allowed)) process.exitCode = 1;
}
