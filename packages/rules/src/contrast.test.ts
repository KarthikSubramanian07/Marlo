import { describe, expect, it } from 'vitest';
import type { Capability, ExpectedOutcome, Outcome } from '@marlo/schema';
import type { Box, MarloDocument } from './dom.js';
import { evaluateRules, fixture } from './index.js';
import { contrastApplicability, measureContrast } from './paint.js';

/**
 * The contrast rules and the paint-order walk behind them.
 *
 * Every one of the 57 official test cases is transcribed below as a fixture carrying
 * the computed styles and the boxes Chromium resolves for it. The values were read off
 * the markup and, where a case has a stylesheet, resolved by hand; each entry says
 * which. The expected outcome is the corpus's, and beside it is what Marlo answers,
 * which differs in exactly three shapes, all recorded in `WHY_NOT_EXACT` below:
 *
 *   cantTell where the background is an image or a gradient, or the text has a shadow,
 *   because there is no single background colour and a guess would be a guess;
 *
 *   inapplicable rather than passed on the two symbol-string dividers, which the rule
 *   exempts as conveying nothing in a human language (the false positive recorded
 *   against Alfa in packages/engines/src/alfa/mapping.ts);
 *
 *   passed rather than inapplicable on the two undisabled widgets, because the vendored
 *   corpus predates the published rule narrowing its widget exemption to disabled ones.
 *
 * Every one of those is an outcome the grading protocol allows for the example.
 */

const ALL_CAPS = new Set<Capability>(['dom', 'script', 'layout', 'paint']);

type Styles = Record<string, string>;

/**
 * What Chromium resolves for an unstyled element in a light colour scheme. A fixture
 * entry overrides these; `font-size` and `color` have to be present on every element in
 * the walk, so they are here rather than being assumed by the walk itself.
 */
const DEFAULTS: Styles = {
  color: 'rgb(0, 0, 0)',
  'background-color': 'rgba(0, 0, 0, 0)',
  'font-size': '16px',
  'font-weight': '400',
};

const PAGE: Box = { x: 0, y: 0, width: 1280, height: 800 };
const LINE: Box = { x: 8, y: 16, width: 1264, height: 18 };

/** The stylesheet-resolved image url in the two black-hole cases. */
const BLACK_HOLE = 'url("https://marlo.invalid/test-assets/contrast/black-hole.jpeg")';

/**
 * Builds a page with resolved styles. `html` and `body` get defaults unless overridden,
 * every keyed element gets the defaults merged under its overrides, and every keyed
 * element gets a one-line box unless `boxes` says otherwise.
 */
function page(
  html: string,
  computed: Record<string, Styles>,
  boxes: Record<string, Box> = {},
): MarloDocument {
  const styles: Record<string, Styles> = { html: DEFAULTS, body: DEFAULTS };
  for (const [key, overrides] of Object.entries(computed)) {
    styles[key] = { ...DEFAULTS, ...overrides };
  }
  const geometry: Record<string, Box> = { html: PAGE, body: PAGE };
  for (const key of Object.keys(computed)) geometry[key] = boxes[key] ?? LINE;
  for (const [key, box] of Object.entries(boxes)) geometry[key] = box;
  return fixture(html, { computed: styles, boxes: geometry });
}

function run(
  actId: string,
  document: MarloDocument,
): { outcome: Outcome | 'unsupported' | 'error'; messages: string[] } {
  const report = evaluateRules([actId], {
    document,
    renderer: 'browser',
    capabilities: ALL_CAPS,
    version: 'test',
  });
  const result = report.results[0];
  if (result === undefined) throw new Error('no result');
  if (result.status !== 'ok') return { outcome: result.status, messages: [] };
  const messages = result.verdicts.map((v) => v.message);
  if (result.verdicts.length === 0) return { outcome: 'inapplicable', messages };
  if (result.verdicts.some((v) => v.outcome === 'failed')) return { outcome: 'failed', messages };
  if (result.verdicts.some((v) => v.outcome === 'cantTell')) {
    return { outcome: 'cantTell', messages };
  }
  return { outcome: 'passed', messages };
}

interface CorpusCase {
  readonly rule: 'afw4f7' | '09o5cg';
  readonly id: string;
  readonly title: string;
  readonly corpus: ExpectedOutcome;
  readonly marlo: Outcome;
  readonly html: string;
  readonly computed: Record<string, Styles>;
  readonly boxes?: Record<string, Box>;
  /** A fragment every message must contain, where the outcome is a verdict. */
  readonly says?: string;
}

/** The cases where Marlo's answer is not the corpus's, and why. */
const WHY_NOT_EXACT: Readonly<Record<string, string>> = {
  'afw4f7/11ec274f': 'background image: no single background colour',
  'afw4f7/b84e9e1a': 'background image: no single background colour',
  'afw4f7/76cfbf96': 'gradient: the ratio varies across it',
  'afw4f7/e9a5aad9': 'gradient: the ratio varies across it',
  'afw4f7/e1094dcd': 'gradient background-image from a stylesheet',
  'afw4f7/b09119e2': 'text-shadow: a shadow needs a human judgement',
  'afw4f7/0b212e48': 'symbol string: exempt as conveying nothing in a human language',
  'afw4f7/ae9c5ac9': 'undisabled button: applicable under the published rule, and it passes',
  'afw4f7/778de4be': 'undisabled role=button: applicable under the published rule, and it passes',
  '09o5cg/05113794': 'background image: no single background colour',
  '09o5cg/d30f6df3': 'background image: no single background colour',
  '09o5cg/64c3822f': 'gradient: the ratio varies across it',
  '09o5cg/bb8261f0': 'gradient: the ratio varies across it',
  '09o5cg/26db5075': 'gradient background-image from a stylesheet',
  '09o5cg/c83b77f0': 'symbol string: exempt as conveying nothing in a human language',
  '09o5cg/7acf59ad': 'undisabled button: applicable under the published rule, and it passes',
  '09o5cg/239b4c6c': 'undisabled role=button: applicable under the published rule, and it passes',
};

/**
 * Shared transcriptions. The 09o5cg corpus repeats most afw4f7 markup with other
 * colours, so the shapes are functions of the colour values. Ids are added to key the
 * styles and change nothing a browser paints.
 */
function paragraph(colour: string, background: string, extra: Styles = {}): CorpusCase['computed'] {
  return { '#t': { color: colour, 'background-color': background, ...extra } };
}

const SYMBOLS = '----=====++++++++___________***********%%%%%%%%%%%±±±±@@@@@@@@';

const CASES: readonly CorpusCase[] = [
  // afw4f7, in corpus file order.
  {
    rule: 'afw4f7',
    id: '0b212e48',
    title: 'Passed Example 7',
    corpus: 'passed',
    marlo: 'inapplicable',
    html: `<body><p id="t" style="color: #000; background: #666;">${SYMBOLS}</p></body>`,
    computed: paragraph('rgb(0, 0, 0)', 'rgb(102, 102, 102)'),
  },
  {
    rule: 'afw4f7',
    id: '11ec274f',
    title: 'Failed Example 3',
    corpus: 'failed',
    marlo: 'cantTell',
    html: '<body><p id="t">Black hole sun</p></body>',
    computed: paragraph('rgb(85, 85, 85)', 'rgb(0, 0, 0)', { 'background-image': BLACK_HOLE }),
    boxes: { '#t': { x: 8, y: 16, width: 1264, height: 70 } },
    says: 'background image',
  },
  {
    // The flat tree: the script puts a span with its own colour inside the shadow root
    // of p#p, and the span's text is the only text.
    rule: 'afw4f7',
    id: '1934f556',
    title: 'Passed Example 9',
    corpus: 'passed',
    marlo: 'passed',
    html: '<body><p id="p"><span id="t">Some text in English</span></p></body>',
    computed: {
      '#p': { color: 'rgb(204, 204, 204)', 'background-color': 'rgb(255, 255, 255)' },
      '#t': { color: 'rgb(51, 51, 51)' },
    },
    says: '12.63:1',
  },
  {
    rule: 'afw4f7',
    id: '197c1264',
    title: 'Passed Example 1',
    corpus: 'passed',
    marlo: 'passed',
    html: '<body><p id="t">Some text in a human language</p></body>',
    computed: paragraph('rgb(51, 51, 51)', 'rgb(255, 255, 255)'),
    says: '12.63:1',
  },
  {
    rule: 'afw4f7',
    id: '25998b87',
    title: 'Failed Example 1',
    corpus: 'failed',
    marlo: 'failed',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgb(170, 170, 170)', 'rgb(255, 255, 255)'),
    says: '2.32:1',
  },
  {
    rule: 'afw4f7',
    id: '28a2fa1f',
    title: 'Inapplicable Example 8',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><label id="t">My name <input id="i" type="text" disabled /></label></body>',
    computed: { '#t': { color: 'rgb(136, 136, 136)', 'background-color': 'rgb(255, 255, 255)' } },
  },
  {
    rule: 'afw4f7',
    id: '3501cb73',
    title: 'Passed Example 5',
    corpus: 'passed',
    marlo: 'passed',
    html: '<body><p id="t">Some text in a human language</p></body>',
    computed: paragraph('rgb(0, 0, 0)', 'rgb(102, 102, 102)', { 'font-size': '24px' }),
    says: '3.66:1',
  },
  {
    rule: 'afw4f7',
    id: '54ecd88e',
    title: 'Inapplicable Example 11',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><div id="g" role="group" aria-disabled="true"><label id="t">My name <input id="i" /></label></div></body>',
    computed: {
      '#g': { color: 'rgb(136, 136, 136)', 'background-color': 'rgb(255, 255, 255)' },
      '#t': { color: 'rgb(136, 136, 136)' },
    },
  },
  {
    // The flat tree: the shadow root's text node is p#p's own text.
    rule: 'afw4f7',
    id: '6f8fa71c',
    title: 'Failed Example 6',
    corpus: 'failed',
    marlo: 'failed',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgb(170, 170, 170)', 'rgb(255, 255, 255)'),
    says: '2.32:1',
  },
  {
    rule: 'afw4f7',
    id: '71886cad',
    title: 'Failed Example 5',
    corpus: 'failed',
    marlo: 'failed',
    html: '<body><div id="d"><p id="t">Some text in English</p></div></body>',
    computed: {
      '#d': { 'background-color': 'rgb(255, 255, 255)' },
      '#t': { color: 'rgb(0, 0, 0)', opacity: '0.3' },
    },
    says: '2.11:1',
  },
  {
    rule: 'afw4f7',
    id: '732a9948',
    title: 'Failed Example 4',
    corpus: 'failed',
    marlo: 'failed',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgba(0, 0, 0, 0.3)', 'rgb(255, 255, 255)'),
    says: '2.11:1',
  },
  {
    rule: 'afw4f7',
    id: '76cfbf96',
    title: 'Failed Example 2',
    corpus: 'failed',
    marlo: 'cantTell',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgb(170, 170, 170)', 'rgba(0, 0, 0, 0)', {
      'background-image': 'linear-gradient(to right, rgb(255, 255, 255), rgb(0, 0, 255))',
    }),
    boxes: { '#t': { x: 8, y: 16, width: 300, height: 18 } },
    says: 'gradient',
  },
  {
    rule: 'afw4f7',
    id: '772b2182',
    title: 'Inapplicable Example 10',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><fieldset id="f" disabled><label id="t">My name <input id="i" /></label></fieldset></body>',
    computed: {
      '#f': { color: 'rgb(136, 136, 136)', 'background-color': 'rgb(255, 255, 255)' },
      '#t': { color: 'rgb(136, 136, 136)' },
    },
  },
  {
    // Chromium gives a div with role=button no styling of its own: black on the canvas.
    rule: 'afw4f7',
    id: '778de4be',
    title: 'Inapplicable Example 7',
    corpus: 'inapplicable',
    marlo: 'passed',
    html: '<body><div id="t" role="button">My button!</div></body>',
    computed: { '#t': {} },
    says: '21.00:1',
  },
  {
    rule: 'afw4f7',
    id: '8edb5419',
    title: 'Failed Example 8',
    corpus: 'failed',
    marlo: 'failed',
    html:
      '<body><p id="a">Helvetica is a widely used sans-serif typeface developed in 1957 by Max Miedinger and Eduard Hoffmann.</p>' +
      '<p id="t">The quick brown fox jumps over the lazy dog.</p></body>',
    computed: {
      '#a': { color: 'rgb(51, 51, 51)', 'background-color': 'rgb(255, 255, 255)' },
      '#t': { color: 'rgb(119, 119, 119)', 'background-color': 'rgb(238, 238, 238)' },
    },
    boxes: { '#a': LINE, '#t': { x: 8, y: 50, width: 1264, height: 18 } },
  },
  {
    rule: 'afw4f7',
    id: '9573b85a',
    title: 'Inapplicable Example 9',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html:
      '<body><label id="my_pets_name">My pet\'s name</label>' +
      '<div id="box" role="textbox" aria-labelledby="my_pets_name" aria-disabled="true">test</div></body>',
    computed: {
      '#my_pets_name': { color: 'rgb(136, 136, 136)', 'background-color': 'rgb(255, 255, 255)' },
      '#box': {},
    },
    boxes: { '#box': { x: 8, y: 34, width: 102, height: 22 } },
  },
  {
    rule: 'afw4f7',
    id: 'abd1c7e9',
    title: 'Inapplicable Example 4',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><svg id="s"><text id="t" x="0" y="15">I love SVG!</text></svg></body>',
    computed: { '#s': {}, '#t': {} },
  },
  {
    // Chromium's default button: black on ButtonFace, 13.3333px.
    rule: 'afw4f7',
    id: 'ae9c5ac9',
    title: 'Inapplicable Example 6',
    corpus: 'inapplicable',
    marlo: 'passed',
    html: '<body><button id="t">My button!</button></body>',
    computed: {
      '#t': { 'background-color': 'rgb(239, 239, 239)', 'font-size': '13.3333px' },
    },
    boxes: { '#t': { x: 8, y: 8, width: 80, height: 21 } },
    says: '18.26:1',
  },
  {
    rule: 'afw4f7',
    id: 'b09119e2',
    title: 'Passed Example 4',
    corpus: 'passed',
    marlo: 'cantTell',
    html: '<body><p id="t">Some text in a human language</p></body>',
    computed: paragraph('rgb(0, 0, 0)', 'rgb(115, 115, 115)', {
      'text-shadow': 'rgb(255, 255, 255) 0px 0px 3px',
    }),
    says: 'text-shadow',
  },
  {
    rule: 'afw4f7',
    id: 'b4cc9477',
    title: 'Inapplicable Example 3',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><p id="t" aria-hidden="true">Hidden text - U U D D L R L R B A S</p></body>',
    computed: paragraph('rgb(255, 255, 255)', 'rgb(255, 255, 255)'),
  },
  {
    rule: 'afw4f7',
    id: 'b84e9e1a',
    title: 'Passed Example 3',
    corpus: 'passed',
    marlo: 'cantTell',
    html: '<body><p id="t">Black hole sun</p></body>',
    computed: paragraph('rgb(204, 204, 204)', 'rgb(0, 0, 0)', { 'background-image': BLACK_HOLE }),
    boxes: { '#t': { x: 8, y: 16, width: 1264, height: 65 } },
    says: 'background image',
  },
  {
    rule: 'afw4f7',
    id: 'c8eeb76f',
    title: 'Inapplicable Example 5',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><p id="t"><img id="i" scr="/test-assets/contrast/example.png" alt="example" /></p></body>',
    computed: { '#t': {}, '#i': {} },
  },
  {
    rule: 'afw4f7',
    id: 'cc241e39',
    title: 'Passed Example 6',
    corpus: 'passed',
    marlo: 'passed',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgb(0, 0, 0)', 'rgb(102, 102, 102)', {
      'font-size': '18.6667px',
      'font-weight': '700',
    }),
    says: 'large text',
  },
  {
    rule: 'afw4f7',
    id: 'd23607da',
    title: 'Passed Example 8',
    corpus: 'passed',
    marlo: 'passed',
    html: '<body><p id="t">Some text in a human language</p></body>',
    computed: { '#t': {} },
    says: '21.00:1',
  },
  {
    rule: 'afw4f7',
    id: 'd7d54e8d',
    title: 'Inapplicable Example 1',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><p id="t" style="display: none">Some invisible text in English</p></body>',
    computed: { '#t': { display: 'none' } },
    boxes: { '#t': { x: 0, y: 0, width: 0, height: 0 } },
  },
  {
    // 999em at 16px is 15984px above the top of the document.
    rule: 'afw4f7',
    id: 'd8f7599e',
    title: 'Inapplicable Example 2',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><p id="t">Some invisible text in English</p></body>',
    computed: { '#t': { position: 'absolute' } },
    boxes: { '#t': { x: 8, y: -15984, width: 230, height: 18 } },
  },
  {
    // Stylesheet, resolved by hand: colour rgba(90, 90, 90, 0.8) and a gradient
    // background-image with no background-color.
    rule: 'afw4f7',
    id: 'e1094dcd',
    title: 'Failed Example 7',
    corpus: 'failed',
    marlo: 'cantTell',
    html: '<body><span id="backgroundSplit">Hello world</span></body>',
    computed: {
      '#backgroundSplit': {
        color: 'rgba(90, 90, 90, 0.8)',
        'background-image':
          'linear-gradient(90deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0) 52.8px, rgb(0, 0, 0) 52.8px, rgb(0, 0, 0) 96px)',
      },
    },
    boxes: { '#backgroundSplit': { x: 8, y: 8, width: 118, height: 18 } },
    says: 'span#backgroundSplit',
  },
  {
    rule: 'afw4f7',
    id: 'e9a5aad9',
    title: 'Passed Example 2',
    corpus: 'passed',
    marlo: 'cantTell',
    html: '<body><p id="t">Some text in a human language</p></body>',
    computed: paragraph('rgb(51, 51, 51)', 'rgba(0, 0, 0, 0)', {
      'background-image': 'linear-gradient(to right, rgb(255, 255, 255), rgb(0, 0, 255))',
    }),
    boxes: { '#t': { x: 8, y: 16, width: 500, height: 18 } },
    says: 'gradient',
  },

  // 09o5cg, in corpus file order.
  {
    rule: '09o5cg',
    id: '0118096d',
    title: 'Inapplicable Example 5',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><p id="t"><img id="i" scr="/test-assets/contrast/example.png" alt="example" /></p></body>',
    computed: { '#t': {}, '#i': {} },
  },
  {
    rule: '09o5cg',
    id: '05113794',
    title: 'Failed Example 5',
    corpus: 'failed',
    marlo: 'cantTell',
    html: '<body><p id="t">Black hole sun</p></body>',
    computed: paragraph('rgb(119, 119, 119)', 'rgb(0, 0, 0)', { 'background-image': BLACK_HOLE }),
    boxes: { '#t': { x: 8, y: 16, width: 1264, height: 70 } },
    says: 'background image',
  },
  {
    rule: '09o5cg',
    id: '239b4c6c',
    title: 'Inapplicable Example 7',
    corpus: 'inapplicable',
    marlo: 'passed',
    html: '<body><div id="t" role="button">My button!</div></body>',
    computed: { '#t': {} },
    says: '21.00:1',
  },
  {
    rule: '09o5cg',
    id: '260cbaac',
    title: 'Inapplicable Example 10',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><fieldset id="f" disabled><label id="t">My name <input id="i" /></label></fieldset></body>',
    computed: {
      '#f': { color: 'rgb(136, 136, 136)', 'background-color': 'rgb(255, 255, 255)' },
      '#t': { color: 'rgb(136, 136, 136)' },
    },
  },
  {
    // Stylesheet, resolved by hand, as for afw4f7/e1094dcd with alpha 0.9.
    rule: '09o5cg',
    id: '26db5075',
    title: 'Failed Example 9',
    corpus: 'failed',
    marlo: 'cantTell',
    html: '<body><span id="backgroundSplit">Hello world</span></body>',
    computed: {
      '#backgroundSplit': {
        color: 'rgba(90, 90, 90, 0.9)',
        'background-image':
          'linear-gradient(90deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0) 52.8px, rgb(0, 0, 0) 52.8px, rgb(0, 0, 0) 96px)',
      },
    },
    boxes: { '#backgroundSplit': { x: 8, y: 8, width: 118, height: 18 } },
    says: 'gradient',
  },
  {
    rule: '09o5cg',
    id: '2879461e',
    title: 'Failed Example 10',
    corpus: 'failed',
    marlo: 'failed',
    html:
      '<body><p id="a">Helvetica is a widely used sans-serif typeface developed in 1957 by Max Miedinger and Eduard Hoffmann.</p>' +
      '<p id="t">The quick brown fox jumps over the lazy dog.</p></body>',
    computed: {
      '#a': { color: 'rgb(51, 51, 51)', 'background-color': 'rgb(255, 255, 255)' },
      '#t': { color: 'rgb(85, 85, 85)', 'background-color': 'rgb(238, 238, 238)' },
    },
    boxes: { '#a': LINE, '#t': { x: 8, y: 50, width: 1264, height: 18 } },
  },
  {
    rule: '09o5cg',
    id: '36e7493a',
    title: 'Passed Example 7',
    corpus: 'passed',
    marlo: 'passed',
    html: '<body><p id="t">Some text in a human language</p></body>',
    computed: { '#t': {} },
    says: '21.00:1',
  },
  {
    rule: '09o5cg',
    id: '3ad86578',
    title: 'Inapplicable Example 8',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><label id="t">My name <input id="i" type="text" disabled /></label></body>',
    computed: { '#t': { color: 'rgb(136, 136, 136)', 'background-color': 'rgb(255, 255, 255)' } },
  },
  {
    rule: '09o5cg',
    id: '47081a30',
    title: 'Passed Example 4',
    corpus: 'passed',
    marlo: 'passed',
    html: '<body><p id="t">Some text in a human language</p></body>',
    computed: paragraph('rgb(0, 0, 0)', 'rgb(119, 119, 119)', { 'font-size': '24px' }),
    says: '4.69:1',
  },
  {
    rule: '09o5cg',
    id: '498558ee',
    title: 'Failed Example 1',
    corpus: 'failed',
    marlo: 'failed',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgb(102, 102, 102)', 'rgb(255, 255, 255)'),
    says: '5.74:1',
  },
  {
    rule: '09o5cg',
    id: '4ba7e759',
    title: 'Failed Example 7',
    corpus: 'failed',
    marlo: 'failed',
    html: '<body><div id="d"><p id="t">Some text in English</p></div></body>',
    computed: {
      '#d': { 'background-color': 'rgb(255, 255, 255)' },
      '#t': { color: 'rgb(0, 0, 0)', opacity: '0.6' },
    },
    says: '5.74:1',
  },
  {
    rule: '09o5cg',
    id: '4f98f90e',
    title: 'Failed Example 3',
    corpus: 'failed',
    marlo: 'failed',
    html: '<body><p id="t">Some text in a human language</p></body>',
    computed: paragraph('rgb(0, 0, 0)', 'rgb(102, 102, 102)', { 'font-size': '24px' }),
    says: '3.66:1',
  },
  {
    rule: '09o5cg',
    id: '591c450f',
    title: 'Passed Example 1',
    corpus: 'passed',
    marlo: 'passed',
    html: '<body><p id="t">Some text in a human language</p></body>',
    computed: paragraph('rgb(51, 51, 51)', 'rgb(255, 255, 255)'),
    says: '12.63:1',
  },
  {
    rule: '09o5cg',
    id: '64c3822f',
    title: 'Passed Example 2',
    corpus: 'passed',
    marlo: 'cantTell',
    html: '<body><p id="t">Some text in a human language</p></body>',
    computed: paragraph('rgb(51, 51, 51)', 'rgba(0, 0, 0, 0)', {
      'background-image': 'linear-gradient(to right, rgb(255, 255, 255), rgb(187, 187, 255))',
    }),
    boxes: { '#t': { x: 8, y: 16, width: 500, height: 18 } },
    says: 'gradient',
  },
  {
    rule: '09o5cg',
    id: '790cb87d',
    title: 'Failed Example 6',
    corpus: 'failed',
    marlo: 'failed',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgba(0, 0, 0, 0.6)', 'rgb(255, 255, 255)'),
    says: '5.74:1',
  },
  {
    rule: '09o5cg',
    id: '7acf59ad',
    title: 'Inapplicable Example 6',
    corpus: 'inapplicable',
    marlo: 'passed',
    html: '<body><button id="t">My button!</button></body>',
    computed: {
      '#t': { 'background-color': 'rgb(239, 239, 239)', 'font-size': '13.3333px' },
    },
    boxes: { '#t': { x: 8, y: 8, width: 80, height: 21 } },
    says: '18.26:1',
  },
  {
    rule: '09o5cg',
    id: '7fec538e',
    title: 'Inapplicable Example 9',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html:
      '<body><label id="my_pets_name">My pet\'s name</label>' +
      '<div id="box" role="textbox" aria-labelledby="my_pets_name" aria-disabled="true">test</div></body>',
    computed: {
      '#my_pets_name': { color: 'rgb(136, 136, 136)', 'background-color': 'rgb(255, 255, 255)' },
      '#box': {},
    },
    boxes: { '#box': { x: 8, y: 34, width: 102, height: 22 } },
  },
  {
    rule: '09o5cg',
    id: 'a7a2d717',
    title: 'Inapplicable Example 1',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><p id="t" style="display: none">Some invisible text in English</p></body>',
    computed: { '#t': { display: 'none' } },
    boxes: { '#t': { x: 0, y: 0, width: 0, height: 0 } },
  },
  {
    rule: '09o5cg',
    id: 'ae81496d',
    title: 'Inapplicable Example 4',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><svg id="s"><text id="t" x="0" y="15">I love SVG!</text></svg></body>',
    computed: { '#s': {}, '#t': {} },
  },
  {
    rule: '09o5cg',
    id: 'bb8261f0',
    title: 'Failed Example 2',
    corpus: 'failed',
    marlo: 'cantTell',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgb(102, 102, 102)', 'rgba(0, 0, 0, 0)', {
      'background-image': 'linear-gradient(to right, rgb(255, 255, 255), rgb(0, 255, 255))',
    }),
    boxes: { '#t': { x: 8, y: 16, width: 300, height: 18 } },
    says: 'gradient',
  },
  {
    rule: '09o5cg',
    id: 'bcbeab7b',
    title: 'Inapplicable Example 2',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><p id="t">Some invisible text in English</p></body>',
    computed: { '#t': { position: 'absolute' } },
    boxes: { '#t': { x: 8, y: -15984, width: 230, height: 18 } },
  },
  {
    // The flat tree, as for afw4f7/6f8fa71c.
    rule: '09o5cg',
    id: 'c2dcc599',
    title: 'Failed Example 8',
    corpus: 'failed',
    marlo: 'failed',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgb(102, 102, 102)', 'rgb(255, 255, 255)'),
    says: '5.74:1',
  },
  {
    rule: '09o5cg',
    id: 'c83b77f0',
    title: 'Passed Example 6',
    corpus: 'passed',
    marlo: 'inapplicable',
    html: `<body><p id="t" style="color: #000; background: #666;">${SYMBOLS}</p></body>`,
    computed: paragraph('rgb(0, 0, 0)', 'rgb(102, 102, 102)'),
  },
  {
    // The flat tree, as for afw4f7/1934f556.
    rule: '09o5cg',
    id: 'cd21ba82',
    title: 'Passed Example 8',
    corpus: 'passed',
    marlo: 'passed',
    html: '<body><p id="p"><span id="t">Some text in English</span></p></body>',
    computed: {
      '#p': { color: 'rgb(204, 204, 204)', 'background-color': 'rgb(255, 255, 255)' },
      '#t': { color: 'rgb(51, 51, 51)' },
    },
    says: '12.63:1',
  },
  {
    rule: '09o5cg',
    id: 'cd74f2cc',
    title: 'Inapplicable Example 3',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><p id="t" aria-hidden="true">Hidden text - U U D D L R L R B A S</p></body>',
    computed: paragraph('rgb(255, 255, 255)', 'rgb(255, 255, 255)'),
  },
  {
    rule: '09o5cg',
    id: 'd30f6df3',
    title: 'Passed Example 3',
    corpus: 'passed',
    marlo: 'cantTell',
    html: '<body><p id="t">Black hole sun</p></body>',
    computed: paragraph('rgb(238, 238, 238)', 'rgb(0, 0, 0)', { 'background-image': BLACK_HOLE }),
    boxes: { '#t': { x: 8, y: 16, width: 1264, height: 65 } },
    says: 'background image',
  },
  {
    rule: '09o5cg',
    id: 'f086a8df',
    title: 'Passed Example 5',
    corpus: 'passed',
    marlo: 'passed',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgb(0, 0, 0)', 'rgb(119, 119, 119)', {
      'font-size': '18.6667px',
      'font-weight': '700',
    }),
    says: '4.69:1',
  },
  {
    rule: '09o5cg',
    id: 'f24f1db0',
    title: 'Failed Example 4',
    corpus: 'failed',
    marlo: 'failed',
    html: '<body><p id="t">Some text in English</p></body>',
    computed: paragraph('rgb(0, 0, 0)', 'rgb(102, 102, 102)', {
      'font-size': '18.6667px',
      'font-weight': '700',
    }),
    says: '3.66:1',
  },
  {
    rule: '09o5cg',
    id: 'fa58fa23',
    title: 'Inapplicable Example 11',
    corpus: 'inapplicable',
    marlo: 'inapplicable',
    html: '<body><div id="g" role="group" aria-disabled="true"><label id="t">My name <input id="i" /></label></div></body>',
    computed: {
      '#g': { color: 'rgb(136, 136, 136)', 'background-color': 'rgb(255, 255, 255)' },
      '#t': { color: 'rgb(136, 136, 136)' },
    },
  },
];

describe('the 57 official contrast test cases, transcribed with their resolved styles', () => {
  it('covers every case of both rules exactly once', () => {
    expect(CASES.filter((c) => c.rule === 'afw4f7')).toHaveLength(28);
    expect(CASES.filter((c) => c.rule === '09o5cg')).toHaveLength(29);
    expect(new Set(CASES.map((c) => `${c.rule}/${c.id}`)).size).toBe(57);
  });

  it('explains every answer that is not the corpus answer, and only those', () => {
    const divergent = CASES.filter((c) => c.marlo !== c.corpus).map((c) => `${c.rule}/${c.id}`);
    expect(divergent.sort()).toEqual(Object.keys(WHY_NOT_EXACT).sort());
    // Each divergence is an outcome the protocol allows, so none is a false positive.
    for (const c of CASES) {
      if (c.corpus === 'failed') expect(['failed', 'cantTell'], c.id).toContain(c.marlo);
      else expect(c.marlo, c.id).not.toBe('failed');
    }
  });

  it.each(CASES.map((c) => [`${c.rule}/${c.id} ${c.title}`, c] as const))('%s', (_label, c) => {
    const result = run(c.rule, page(c.html, c.computed, c.boxes));
    expect(result.outcome).toBe(c.marlo);
    if (c.says !== undefined) expect(result.messages.join(' ')).toContain(c.says);
  });
});

describe('the paint-order walk', () => {
  it('fails body copy that reaches the page through a 30 percent opacity ancestor', () => {
    // The HONESTY.md entry 6 shape: text that passes at full opacity and is faded, with
    // its whole section, by a scroll-linked reveal that can rest at 30 percent. The
    // text alone would be 21:1; through the group it is 2.11:1.
    const document = page(
      '<body><section id="reveal"><p id="t">Body copy worth reading</p></section></body>',
      { '#reveal': { opacity: '0.3' }, '#t': { color: 'rgb(0, 0, 0)' } },
    );
    const result = run('afw4f7', document);
    expect(result.outcome).toBe('failed');
    expect(result.messages[0]).toContain('rgb(179, 179, 179) on rgb(255, 255, 255)');
    expect(result.messages[0]).toContain('2.11:1');
    expect(result.messages[0]).toContain('section#reveal has opacity 0.3');
  });

  it('reproduces the 4.22:1 that HONESTY.md entry 6 records for faded body copy', () => {
    // The site palette: muted grey copy on the near-black page, 7.70:1 at rest, inside a
    // section the scroll reveal holds at 70 percent. The page background is outside the
    // faded group, so only the text fades into it.
    const document = page(
      '<body><section id="reveal"><p id="t">Body copy worth reading</p></section></body>',
      {
        body: { 'background-color': 'rgb(9, 9, 11)' },
        '#reveal': { opacity: '0.7' },
        '#t': { color: 'rgb(161, 161, 161)' },
      },
    );
    const result = run('afw4f7', document);
    expect(result.outcome).toBe('failed');
    expect(result.messages[0]).toContain('rgb(115, 115, 116) on rgb(9, 9, 11)');
    expect(result.messages[0]).toContain('4.22:1');
    expect(result.messages[0]).toContain('needs at least 4.5:1');

    const atRest = page(
      '<body><section id="reveal"><p id="t">Body copy worth reading</p></section></body>',
      {
        body: { 'background-color': 'rgb(9, 9, 11)' },
        '#reveal': {},
        '#t': { color: 'rgb(161, 161, 161)' },
      },
    );
    expect(run('afw4f7', atRest).messages[0]).toContain('7.70:1');
  });

  it('declines when a positioned element with a background overlaps the text, naming it', () => {
    const document = page(
      '<body><p id="t">Under something</p><div id="overlay" class="toast">Hi</div></body>',
      {
        '#t': {},
        '#overlay': { position: 'absolute', 'background-color': 'rgba(0, 0, 0, 0.5)' },
      },
      { '#overlay': { x: 0, y: 0, width: 400, height: 100 } },
    );
    const result = run('afw4f7', document);
    expect(result.outcome).toBe('cantTell');
    const about = result.messages.find((m) => m.includes('div#overlay'));
    expect(about).toContain('positioned over this text');
    expect(about).toContain('background-color rgba(0, 0, 0, 0.5)');
  });

  it('ignores a positioned element whose background is fully transparent or that does not overlap', () => {
    const document = page(
      '<body><p id="t">Clear</p><div id="a">x</div><div id="b">y</div></body>',
      {
        '#t': {},
        '#a': { position: 'fixed' },
        '#b': { position: 'absolute', 'background-color': 'rgb(255, 0, 0)' },
      },
      {
        '#a': { x: 0, y: 0, width: 400, height: 100 },
        '#b': { x: 0, y: 500, width: 400, height: 100 },
      },
    );
    expect(run('afw4f7', document).outcome).toBe('passed');
  });

  it('declines on an opaque child of a transparent positioned wrapper, naming both', () => {
    const document = page(
      '<body><p id="t">Under a modal</p><div id="wrap"><div id="dialog">Hi</div></div></body>',
      {
        '#t': {},
        '#wrap': { position: 'fixed' },
        '#dialog': { color: 'rgb(255, 255, 255)', 'background-color': 'rgb(20, 20, 20)' },
      },
      {
        // The wrapper has no area of its own; its child overflows it onto the text.
        '#wrap': { x: 0, y: 0, width: 0, height: 0 },
        '#dialog': { x: 0, y: 0, width: 400, height: 100 },
      },
    );
    const result = run('afw4f7', document);
    expect(result.outcome).toBe('cantTell');
    const about = result.messages.find((m) => m.includes('div#dialog'));
    expect(about).toContain('div#dialog, inside div#wrap, is positioned over this text');
    expect(about).toContain('background-color rgb(20, 20, 20)');
  });

  it('checks text inside one positioned layer against another layer nested in it', () => {
    const document = page(
      '<body><div id="modal"><p id="t">Inside</p><div id="toast"></div></div></body>',
      {
        '#modal': { position: 'fixed', 'background-color': 'rgb(255, 255, 255)' },
        '#t': {},
        '#toast': { position: 'absolute', 'background-image': 'url("toast.png")' },
      },
      {
        '#modal': { x: 0, y: 0, width: 600, height: 400 },
        '#toast': { x: 0, y: 0, width: 300, height: 60 },
      },
    );
    const result = run('afw4f7', document);
    expect(result.outcome).toBe('cantTell');
    expect(result.messages.join(' ')).toContain('div#toast is positioned over this text');
  });

  it('treats a transform, and a later float, as something that can paint over text', () => {
    const transformed = page(
      '<body><p id="t">Text</p><div id="card"></div></body>',
      {
        '#t': {},
        '#card': { transform: 'matrix(1, 0, 0, 1, -40, -40)', 'background-color': 'rgb(1, 2, 3)' },
      },
      { '#card': { x: 0, y: 0, width: 400, height: 100 } },
    );
    expect(run('afw4f7', transformed).messages[0]).toContain('div#card');

    const laterFloat = page(
      '<body><p id="t">Text</p><aside id="f"></aside></body>',
      { '#t': {}, '#f': { float: 'left', 'background-image': 'url("a.png")' } },
      { '#f': { x: 0, y: 0, width: 400, height: 100 } },
    );
    expect(run('afw4f7', laterFloat).messages[0]).toContain('aside#f');

    // A float earlier in the document has already been flowed around.
    const earlierFloat = page(
      '<body><aside id="f"></aside><p id="t">Text</p></body>',
      { '#f': { float: 'left', 'background-color': 'rgb(1, 2, 3)' }, '#t': {} },
      { '#f': { x: 0, y: 0, width: 400, height: 100 } },
    );
    expect(run('afw4f7', earlierFloat).outcome).toBe('passed');
  });

  it('declines when a dark colour scheme can show through to the canvas', () => {
    const html = '<html><body><p id="t">Scheme</p></body></html>';
    const dark = page(html, { html: { 'color-scheme': 'light dark' }, '#t': {} });
    const declined = run('afw4f7', dark);
    expect(declined.outcome).toBe('cantTell');
    expect(declined.messages[0]).toContain('color-scheme: light dark on html');

    const meta = page(
      '<html><head><meta name="color-scheme" content="dark"></head><body><p id="t">Scheme</p></body></html>',
      { '#t': {} },
    );
    expect(run('afw4f7', meta).messages[0]).toContain('<meta name="color-scheme" content="dark">');

    // An opaque background seals the stack, so the canvas never shows.
    const sealed = page(html, {
      html: { 'color-scheme': 'dark' },
      body: { 'background-color': 'rgb(255, 255, 255)' },
      '#t': {},
    });
    expect(run('afw4f7', sealed).outcome).toBe('passed');

    const light = page(
      '<html><head><meta name="color-scheme" content="only light"></head><body><p id="t">Scheme</p></body></html>',
      { html: { 'color-scheme': 'light' }, '#t': {} },
    );
    expect(run('afw4f7', light).outcome).toBe('passed');
  });

  it('declines on a gradient ancestor, naming it', () => {
    const document = page('<body><div id="hero"><p id="t">Welcome</p></div></body>', {
      '#hero': { 'background-image': 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))' },
      '#t': { color: 'rgb(255, 255, 255)' },
    });
    const result = run('afw4f7', document);
    expect(result.outcome).toBe('cantTell');
    expect(result.messages[0]).toContain('div#hero has a gradient');
    expect(result.messages[0]).toContain('lightest and the darkest point');
  });

  it('composites translucent text over a translucent background over a dark ancestor', () => {
    // Naively, white text on a half-white box reads as 255 on 128, a ratio above 4.5.
    // The text is itself half transparent: it is 191 on 128, which is 2.17:1.
    const document = page('<body><div id="dark"><p id="t">Ghost</p></div></body>', {
      '#dark': { 'background-color': 'rgb(0, 0, 0)' },
      '#t': { color: 'rgba(255, 255, 255, 0.5)', 'background-color': 'rgba(255, 255, 255, 0.5)' },
    });
    const result = run('afw4f7', document);
    expect(result.outcome).toBe('failed');
    expect(result.messages[0]).toContain('rgb(191, 191, 191) on rgb(128, 128, 128)');
    expect(result.messages[0]).toContain('2.17:1');
    expect(result.messages[0]).toContain('text colour rgba(255, 255, 255, 0.5) is translucent');
    expect(result.messages[0]).toContain(
      'background of p#t, rgba(255, 255, 255, 0.5), is translucent',
    );
  });

  it('stops at an opaque background, so a gradient further up does not matter', () => {
    const document = page('<body><div id="hero"><p id="t">Card text</p></div></body>', {
      '#hero': { 'background-image': 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))' },
      '#t': { color: 'rgb(0, 0, 0)', 'background-color': 'rgb(255, 255, 255)' },
    });
    expect(run('afw4f7', document).outcome).toBe('passed');
  });

  it('reopens the stack when an opacity above the opaque layer lets the gradient through', () => {
    const document = page(
      '<body><div id="hero"><div id="fade"><p id="t">Card text</p></div></div></body>',
      {
        '#hero': { 'background-image': 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))' },
        '#fade': { opacity: '0.9' },
        '#t': { color: 'rgb(0, 0, 0)', 'background-color': 'rgb(255, 255, 255)' },
      },
    );
    const result = run('afw4f7', document);
    expect(result.outcome).toBe('cantTell');
    expect(result.messages[0]).toContain('div#hero');
  });

  it('declines on a blend mode, a filter or a backdrop filter anywhere in the stack', () => {
    for (const [property, value] of [
      ['mix-blend-mode', 'multiply'],
      ['filter', 'blur(2px)'],
      ['backdrop-filter', 'blur(4px)'],
    ] as const) {
      const document = page('<body><div id="fx"><p id="t">Text</p></div></body>', {
        '#fx': { [property]: value },
        '#t': {},
      });
      const result = run('afw4f7', document);
      expect(result.outcome, property).toBe('cantTell');
      expect(result.messages[0]).toContain(`div#fx has ${property}: ${value}`);
    }
  });

  it('declines on a text stroke or a differing text fill colour', () => {
    const stroked = page('<body><p id="t">Outlined</p></body>', {
      '#t': { '-webkit-text-stroke-width': '1px' },
    });
    expect(run('afw4f7', stroked).messages[0]).toContain('text stroke of 1px');

    const filled = page('<body><p id="t">Filled</p></body>', {
      '#t': { '-webkit-text-fill-color': 'rgb(255, 0, 0)' },
    });
    expect(run('afw4f7', filled).messages[0]).toContain('-webkit-text-fill-color rgb(255, 0, 0)');

    const unreadableFill = page('<body><p id="t">Filled</p></body>', {
      '#t': { '-webkit-text-fill-color': 'oklch(0.5 0.1 200)' },
    });
    expect(run('afw4f7', unreadableFill).outcome).toBe('cantTell');

    // The computed fill colour normally equals the colour, and then it is not a reason.
    const same = page('<body><p id="t">Plain</p></body>', {
      '#t': { color: 'rgb(0, 0, 0)', '-webkit-text-fill-color': 'rgb(0, 0, 0)' },
    });
    expect(run('afw4f7', same).outcome).toBe('passed');
    const stroke0 = page('<body><p id="t">Plain</p></body>', {
      '#t': { '-webkit-text-stroke-width': '0px' },
    });
    expect(run('afw4f7', stroke0).outcome).toBe('passed');
  });

  it('declines on a colour space it does not convert, naming the element and the value', () => {
    const text = page('<body><p id="t">Modern</p></body>', {
      '#t': { color: 'oklch(0.3 0.1 20)' },
    });
    const result = run('afw4f7', text);
    expect(result.outcome).toBe('cantTell');
    expect(result.messages[0]).toContain('The color of p#t is oklch(0.3 0.1 20)');

    const background = page('<body><div id="wrap"><p id="t">Modern</p></div></body>', {
      '#wrap': { 'background-color': 'lab(50% 40 59.5)' },
      '#t': {},
    });
    expect(run('afw4f7', background).messages[0]).toContain(
      'The background-color of div#wrap is lab(50% 40 59.5)',
    );
  });

  it('resolves currentcolor to the text colour, and to the parent colour for color itself', () => {
    const sameAsText = page('<body><p id="t">Invisible</p></body>', {
      '#t': { color: 'rgb(10, 20, 30)', 'background-color': 'currentcolor' },
    });
    const result = run('afw4f7', sameAsText);
    expect(result.outcome).toBe('failed');
    expect(result.messages[0]).toContain('rgb(10, 20, 30) on rgb(10, 20, 30)');
    expect(result.messages[0]).toContain('1.00:1');

    const inherited = page('<body><div id="wrap"><p id="t">Inherited</p></div></body>', {
      '#wrap': { color: 'rgb(170, 170, 170)' },
      '#t': { color: 'currentcolor' },
    });
    expect(run('afw4f7', inherited).messages[0]).toContain('rgb(170, 170, 170) on');

    // The chain runs into an element with no styles at all.
    const unstyledParent = fixture('<html><body><p id="t">Orphan</p></body></html>', {
      computed: { html: DEFAULTS, '#t': { ...DEFAULTS, color: 'currentcolor' } },
      boxes: { html: PAGE, '#t': LINE },
    });
    expect(run('afw4f7', unstyledParent).messages[0]).toContain(
      'No resolved styles are available for body.',
    );

    // No ancestor supplies a colour: that is unknown, not black.
    const root = fixture('<html><p id="t">Rootless</p></html>', {
      computed: {
        html: { ...DEFAULTS, color: 'currentcolor' },
        '#t': { ...DEFAULTS, color: 'currentcolor' },
      },
      boxes: { html: PAGE, '#t': LINE },
    });
    const rootless = run('afw4f7', root);
    expect(rootless.outcome).toBe('cantTell');
    expect(rootless.messages[0]).toContain('no ancestor to inherit from');
  });

  it('measures each element over its own text, so a bold child is a second target', () => {
    const document = page('<body><p id="t">Hello <b id="b">there</b></p></body>', {
      '#t': { color: 'rgb(0, 0, 0)', 'background-color': 'rgb(255, 255, 255)' },
      '#b': { color: 'rgb(170, 170, 170)', 'font-weight': '700' },
    });
    const result = run('afw4f7', document);
    expect(result.messages).toHaveLength(2);
    expect(result.outcome).toBe('failed');
    expect(result.messages[1]).toContain('weight 700');
  });

  it('applies the large-text thresholds of each rule', () => {
    const large = page('<body><p id="t">Large</p></body>', {
      '#t': {
        color: 'rgb(0, 0, 0)',
        'background-color': 'rgb(119, 119, 119)',
        'font-size': '24px',
      },
    });
    expect(run('afw4f7', large).messages[0]).toContain('meets the 3:1 required for large text');
    expect(run('09o5cg', large).messages[0]).toContain('meets the 4.5:1 required for large text');

    const regular = page('<body><p id="t">Regular</p></body>', {
      '#t': { color: 'rgb(0, 0, 0)', 'background-color': 'rgb(102, 102, 102)' },
    });
    expect(run('afw4f7', regular).messages[0]).toContain('which needs at least 4.5:1');
    expect(run('09o5cg', regular).messages[0]).toContain('which needs at least 7:1');
  });

  it('declines when geometry, styles, font size, weight or opacity cannot be read', () => {
    const noBox = fixture('<html><body><p id="t">text</p></body></html>', {
      computed: { html: DEFAULTS, body: DEFAULTS, '#t': DEFAULTS },
    });
    expect(run('afw4f7', noBox).messages[0]).toContain('No geometry is available for p#t');

    const noStyles = fixture('<html><body><p id="t">text</p></body></html>', {
      boxes: { '#t': LINE },
    });
    expect(run('afw4f7', noStyles).messages[0]).toContain(
      'No resolved styles are available for p#t',
    );

    const noAncestorStyles = fixture('<html><body><p id="t">text</p></body></html>', {
      computed: { '#t': DEFAULTS },
      boxes: { '#t': LINE },
    });
    expect(run('afw4f7', noAncestorStyles).messages[0]).toContain(
      'No resolved styles are available for body, which is behind this text',
    );

    const emSize = fixture('<html><body><p id="t">text</p></body></html>', {
      computed: { html: DEFAULTS, body: DEFAULTS, '#t': { color: 'rgb(0, 0, 0)' } },
      boxes: { '#t': LINE },
    });
    expect(run('afw4f7', emSize).messages[0]).toContain('font-size of p#t is missing');

    expect(
      run('afw4f7', page('<body><p id="t">text</p></body>', { '#t': { 'font-weight': 'bolder' } }))
        .messages[0],
    ).toContain('font-weight of p#t is bolder');

    expect(
      run('afw4f7', page('<body><p id="t">text</p></body>', { '#t': { opacity: 'auto' } }))
        .messages[0],
    ).toContain('opacity of p#t is auto');
  });

  it('reads a percentage opacity', () => {
    const document = page('<body><p id="t">text</p></body>', { '#t': { opacity: '30%' } });
    expect(run('afw4f7', document).messages[0]).toContain('2.11:1');
  });
});

describe('contrast applicability', () => {
  function applies(html: string, computed: Record<string, Styles> = {}, boxes = {}): boolean {
    const document = page(html, computed, boxes);
    const target = [...walkIds(document)].find((e) => e.id === 't');
    if (target === undefined) throw new Error('no #t');
    return contrastApplicability(target.element, document).applicable;
  }

  function* walkIds(document: MarloDocument) {
    const stack = [document.root];
    while (stack.length > 0) {
      const element = stack.pop();
      if (element === undefined) break;
      const id = element.attributes.find((a) => a.name === 'id')?.value ?? '';
      yield { id, element };
      stack.push(...element.children);
    }
  }

  it('exempts a disabled control, a descendant of one, and anything aria-disabled', () => {
    expect(applies('<body><button id="t" disabled>Save</button></body>', { '#t': {} })).toBe(false);
    expect(
      applies('<body><select id="s" disabled><option id="t">One</option></select></body>'),
    ).toBe(false);
    expect(applies('<body><div id="t" aria-disabled="true">Off</div></body>')).toBe(false);
    expect(applies('<body><div aria-disabled="true"><span id="t">Off</span></div></body>')).toBe(
      false,
    );
    // `disabled` on an element the attribute does not disable is just an attribute.
    expect(applies('<body><div id="t" disabled>On</div></body>', { '#t': {} })).toBe(true);
    expect(applies('<body><button id="t">Save</button></body>', { '#t': {} })).toBe(true);
  });

  it('exempts the label of a disabled control, by for or by wrapping or by aria-labelledby', () => {
    expect(
      applies('<body><label id="t" for="i">Name</label><input id="i" disabled /></body>', {
        '#t': {},
      }),
    ).toBe(false);
    expect(
      applies('<body><label id="t" for="i">Name</label><input id="i" /></body>', { '#t': {} }),
    ).toBe(true);
    expect(applies('<body><label id="t" for="missing">Name</label></body>', { '#t': {} })).toBe(
      true,
    );
    expect(applies('<body><label id="t">Name</label></body>', { '#t': {} })).toBe(true);
    expect(
      applies('<body><span id="t">Name</span><input aria-labelledby="t other" disabled /></body>', {
        '#t': {},
      }),
    ).toBe(false);
    expect(
      applies('<body><span id="t">Name</span><input aria-labelledby="t" /></body>', { '#t': {} }),
    ).toBe(true);
  });

  it('exempts text with no letters and text in containers that do not render it', () => {
    expect(applies('<body><p id="t">2024 / 12 / 31</p></body>', { '#t': {} })).toBe(false);
    expect(applies('<body><p id="t">→ ★ •</p></body>', { '#t': {} })).toBe(false);
    expect(applies('<body><p id="t">   </p></body>', { '#t': {} })).toBe(false);
    expect(applies('<body><p id="t">日本語</p></body>', { '#t': {} })).toBe(true);
    expect(applies('<body><p id="t">v2</p></body>', { '#t': {} })).toBe(true);
    expect(applies('<body><script id="t">var x = "hello";</script></body>')).toBe(false);
    expect(applies('<body><noscript id="t">Enable scripts</noscript></body>')).toBe(false);
    expect(applies('<body><style id="t">p { color: red }</style></body>')).toBe(false);
    expect(applies('<head><title id="t">Page</title></head><body></body>')).toBe(false);
    expect(applies('<body><math id="m"><mi id="t">x</mi></math></body>')).toBe(false);
  });

  it('exempts hidden text, by display, visibility, opacity 0 or a zero-area box', () => {
    expect(applies('<body><div hidden><p id="t">Gone</p></div></body>', { '#t': {} })).toBe(false);
    expect(
      applies('<body><div id="d"><p id="t">Gone</p></div></body>', {
        '#d': { display: 'none' },
        '#t': {},
      }),
    ).toBe(false);
    expect(applies('<body><p id="t">Gone</p></body>', { '#t': { visibility: 'hidden' } })).toBe(
      false,
    );
    expect(applies('<body><p id="t">Gone</p></body>', { '#t': { visibility: 'collapse' } })).toBe(
      false,
    );
    expect(
      applies('<body><div id="d"><p id="t">Gone</p></div></body>', {
        '#d': { opacity: '0' },
        '#t': {},
      }),
    ).toBe(false);
    expect(
      applies(
        '<body><p id="t">Gone</p></body>',
        { '#t': {} },
        { '#t': { x: 0, y: 0, width: 0, height: 10 } },
      ),
    ).toBe(false);
    expect(
      applies(
        '<body><p id="t">Gone</p></body>',
        { '#t': {} },
        { '#t': { x: -500, y: 10, width: 400, height: 10 } },
      ),
    ).toBe(false);
    // An ancestor's visibility: hidden is undone by the element's own visible.
    expect(
      applies('<body><div id="d"><p id="t">Back</p></div></body>', {
        '#d': { visibility: 'hidden' },
        '#t': { visibility: 'visible' },
      }),
    ).toBe(true);
  });

  it('keeps a negative horizontal position reachable in a right-to-left document', () => {
    const document = fixture('<html dir="rtl"><body><p id="t">مرحبا</p></body></html>', {
      computed: { html: { ...DEFAULTS, direction: 'rtl' }, body: DEFAULTS, '#t': DEFAULTS },
      boxes: { html: PAGE, body: PAGE, '#t': { x: -500, y: 10, width: 400, height: 10 } },
    });
    const target = document.root.children[0]?.children[0];
    if (target === undefined) throw new Error('no target');
    expect(contrastApplicability(target, document).applicable).toBe(true);
  });

  it('keeps an element with no styles or box applicable, so the gap surfaces as cantTell', () => {
    const document = fixture('<html><body><p id="t">text</p></body></html>');
    const target = document.root.children[0]?.children[0];
    if (target === undefined) throw new Error('no target');
    expect(contrastApplicability(target, document).applicable).toBe(true);
    expect(measureContrast(target, document).kind).toBe('undecidable');
  });
});
