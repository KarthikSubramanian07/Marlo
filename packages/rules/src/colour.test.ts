import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Rgba } from './colour.js';
import {
  BLACK,
  NAMED_COLOUR_COUNT,
  TRANSPARENT,
  WHITE,
  contrastRatio,
  formatColour,
  isLargeText,
  over,
  parseColour,
  parseFontSizePx,
  parseFontWeight,
  relativeLuminance,
  scaleAlpha,
} from './colour.js';

/**
 * The colour module is pure arithmetic, so it is covered exhaustively: every syntax a
 * browser can return, every syntax an author commonly writes, the refusals, and the
 * algebraic properties that have to hold for any input.
 */

function rgba(r: number, g: number, b: number, a = 1): Rgba {
  return { r, g, b, a };
}

function parsed(input: string): Rgba {
  const result = parseColour(input);
  if (result.kind !== 'colour') throw new Error(`${input} parsed to ${result.kind}`);
  return result.value;
}

function close(actual: Rgba, expected: Rgba, tolerance = 0.5): void {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.a - expected.a)).toBeLessThanOrEqual(0.001);
}

describe('parseColour', () => {
  it('reads the rgb and rgba forms getComputedStyle returns', () => {
    expect(parsed('rgb(0, 0, 0)')).toEqual(BLACK);
    expect(parsed('rgb(255, 255, 255)')).toEqual(WHITE);
    expect(parsed('rgba(0, 0, 0, 0.3)')).toEqual(rgba(0, 0, 0, 0.3));
    expect(parsed('rgba(0, 0, 0, 0)')).toEqual(TRANSPARENT);
    // Chromium keeps float channels when a colour was composited.
    close(parsed('rgb(178.5, 178.5, 178.5)'), rgba(178.5, 178.5, 178.5), 0);
  });

  it('reads the authored rgb forms: no spaces, percentages, modern syntax, slash alpha', () => {
    expect(parsed('rgb(0,0,0)')).toEqual(BLACK);
    expect(parsed('RGBA(0,0,0,.3)')).toEqual(rgba(0, 0, 0, 0.3));
    expect(parsed('rgb(100%, 0%, 50%)')).toEqual(rgba(255, 0, 127.5));
    expect(parsed('rgb(0 0 0)')).toEqual(BLACK);
    expect(parsed('rgb(0 0 0 / 0.5)')).toEqual(rgba(0, 0, 0, 0.5));
    expect(parsed('rgb(0 0 0 / 50%)')).toEqual(rgba(0, 0, 0, 0.5));
    expect(parsed('rgb(none 0 0)')).toEqual(BLACK);
    expect(parsed('rgb(1e2 0 0)')).toEqual(rgba(100, 0, 0));
  });

  it('clamps channels and alpha into range rather than refusing them', () => {
    expect(parsed('rgb(300, -5, 0)')).toEqual(rgba(255, 0, 0));
    expect(parsed('rgba(0, 0, 0, 1.5)')).toEqual(BLACK);
  });

  it('refuses malformed rgb', () => {
    for (const bad of [
      'rgb(0, 0)',
      'rgb(0, 0, 0, 0, 0)',
      'rgb(0 0 0 0.5)',
      'rgb(0, 0 0)',
      'rgb(0, 0, 0 / 0.5)',
      'rgb(0 0 0 / 0.5 / 1)',
      'rgb(0 0 0 /)',
      'rgb(a, b, c)',
      'rgb(0, 0, 0, x)',
      'rgb()',
      'rgb(0 0 0 / 1 2)',
    ]) {
      expect(parseColour(bad), bad).toEqual({ kind: 'unsupported', input: bad });
    }
  });

  it('reads hex in all four lengths', () => {
    expect(parsed('#000')).toEqual(BLACK);
    expect(parsed('#FFF')).toEqual(WHITE);
    expect(parsed('#333')).toEqual(rgba(51, 51, 51));
    expect(parsed('#0008')).toEqual(rgba(0, 0, 0, 136 / 255));
    expect(parsed('#737373')).toEqual(rgba(115, 115, 115));
    expect(parsed('#00000080')).toEqual(rgba(0, 0, 0, 128 / 255));
  });

  it('refuses hex of the wrong length or with bad digits', () => {
    for (const bad of ['#', '#12', '#12345', '#1234567', '#123456789', '#ggg', '#12g']) {
      expect(parseColour(bad), bad).toEqual({ kind: 'unsupported', input: bad });
    }
  });

  it('reads hsl and hsla, with every angle unit', () => {
    expect(parsed('hsl(0, 100%, 50%)')).toEqual(rgba(255, 0, 0));
    close(parsed('hsl(120, 100%, 25%)'), rgba(0, 127.5, 0), 0.01);
    expect(parsed('hsl(240 100% 50%)')).toEqual(rgba(0, 0, 255));
    expect(parsed('hsla(0, 0%, 0%, 0.5)')).toEqual(rgba(0, 0, 0, 0.5));
    expect(parsed('hsl(0 0% 100% / 25%)')).toEqual(rgba(255, 255, 255, 0.25));
    close(parsed('hsl(0.5turn 100% 50%)'), rgba(0, 255, 255));
    close(parsed('hsl(200grad 100% 50%)'), rgba(0, 255, 255));
    close(parsed('hsl(3.14159265rad 100% 50%)'), rgba(0, 255, 255));
    close(parsed('hsl(180deg 100% 50%)'), rgba(0, 255, 255));
    close(parsed('hsl(-90 100% 50%)'), rgba(127.5, 0, 255));
    close(parsed('hsl(none 0% 50%)'), rgba(127.5, 127.5, 127.5));
    // Bare numbers for saturation and lightness mean percentages in the modern syntax.
    close(parsed('hsl(0 100 50)'), rgba(255, 0, 0));
  });

  it('refuses malformed hsl', () => {
    for (const bad of ['hsl(x, 100%, 50%)', 'hsl(0, y, 50%)', 'hsl(0, 100%, 50%, z)', 'hsl()']) {
      expect(parseColour(bad), bad).toEqual({ kind: 'unsupported', input: bad });
    }
  });

  it('reads transparent, currentcolor and all 148 named colours', () => {
    expect(parsed('transparent')).toEqual(TRANSPARENT);
    expect(parsed(' Transparent ')).toEqual(TRANSPARENT);
    expect(parseColour('currentcolor')).toEqual({ kind: 'currentcolor' });
    expect(parseColour('CurrentColor')).toEqual({ kind: 'currentcolor' });
    expect(NAMED_COLOUR_COUNT).toBe(148);
    expect(parsed('white')).toEqual(WHITE);
    expect(parsed('Black')).toEqual(BLACK);
    expect(parsed('rebeccapurple')).toEqual(rgba(102, 51, 153));
    expect(parsed('grey')).toEqual(parsed('gray'));
    expect(parsed('darkslategrey')).toEqual(rgba(47, 79, 79));
  });

  it('reads color(srgb ...) and refuses every other colour space', () => {
    expect(parsed('color(srgb 1 0 0)')).toEqual(rgba(255, 0, 0));
    expect(parsed('color(srgb 0 0 0 / 0.5)')).toEqual(rgba(0, 0, 0, 0.5));
    expect(parsed('color(srgb 50% 50% 50%)')).toEqual(rgba(127.5, 127.5, 127.5));
    for (const bad of [
      'color(display-p3 1 0 0)',
      'color(srgb-linear 1 0 0)',
      'color(srgb 1, 0, 0)',
      'color(srgb 1 0)',
      'color(srgb a b c)',
      'color(srgb 1 0 0 / q)',
      'color(srgb)',
      'lab(50% 40 59.5)',
      'lch(50% 70 200)',
      'oklab(0.5 0.1 0.1)',
      'oklch(0.7 0.1 200)',
      'color-mix(in srgb, red, blue)',
      'canvastext',
      'ButtonFace',
      'inherit',
      '',
      '   ',
      'notacolour',
      'rgb',
    ]) {
      expect(parseColour(bad), bad).toEqual({ kind: 'unsupported', input: bad });
    }
  });
});

describe('over', () => {
  it('composites a translucent colour onto an opaque backdrop', () => {
    close(over(rgba(0, 0, 0, 0.3), WHITE), rgba(178.5, 178.5, 178.5), 0.001);
    close(over(rgba(255, 0, 0, 0.5), rgba(0, 0, 255)), rgba(127.5, 0, 127.5), 0.001);
  });

  it('keeps translucency when both layers are translucent', () => {
    const result = over(rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.5));
    close(result, rgba(255, 255, 255, 0.75), 0.001);
  });

  it('returns transparent black for two transparent layers', () => {
    expect(over(TRANSPARENT, TRANSPARENT)).toEqual(TRANSPARENT);
    expect(over(rgba(200, 10, 10, 0), rgba(5, 5, 5, 0))).toEqual(TRANSPARENT);
  });

  it('scales alpha the way a group opacity does', () => {
    expect(scaleAlpha(WHITE, 0.3)).toEqual(rgba(255, 255, 255, 0.3));
    expect(scaleAlpha(rgba(0, 0, 0, 0.5), 0.5)).toEqual(rgba(0, 0, 0, 0.25));
    expect(scaleAlpha(WHITE, 2)).toEqual(WHITE);
    expect(scaleAlpha(WHITE, -1)).toEqual(rgba(255, 255, 255, 0));
  });
});

describe('relativeLuminance and contrastRatio', () => {
  it('matches the WCAG reference points', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 10);
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
    // The ratios the ACT examples state, to the precision they state them.
    expect(contrastRatio(parsed('#333'), WHITE)).toBeCloseTo(12.63, 2);
    expect(contrastRatio(parsed('#AAA'), WHITE)).toBeCloseTo(2.32, 2);
    expect(contrastRatio(BLACK, parsed('#666'))).toBeCloseTo(3.66, 2);
    expect(contrastRatio(parsed('#777'), parsed('#EEE'))).toBeCloseTo(3.86, 2);
  });

  it('uses the low-channel linear segment below the threshold', () => {
    // 10/255 is below 0.04045 and goes through the /12.92 branch.
    expect(relativeLuminance(rgba(10, 10, 10))).toBeCloseTo(10 / 255 / 12.92, 10);
  });
});

describe('formatColour', () => {
  it('prints what a browser would', () => {
    expect(formatColour(BLACK)).toBe('rgb(0, 0, 0)');
    expect(formatColour(rgba(178.5, 178.5, 178.5))).toBe('rgb(179, 179, 179)');
    expect(formatColour(rgba(0, 0, 0, 0.3))).toBe('rgba(0, 0, 0, 0.3)');
    expect(formatColour(rgba(0, 0, 0, 1 / 3))).toBe('rgba(0, 0, 0, 0.333)');
    expect(formatColour(rgba(300, -1, 0, 2))).toBe('rgb(255, 0, 0)');
  });
});

describe('the large-text threshold', () => {
  it('is 24px at any weight, or 18.66px at weight 700 and above', () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(23.99, 400)).toBe(false);
    expect(isLargeText(18.6667, 700)).toBe(true);
    expect(isLargeText(18.6667, 699)).toBe(false);
    expect(isLargeText(18.65, 700)).toBe(false);
    expect(isLargeText(16, 900)).toBe(false);
  });

  it('reads computed font sizes and weights, and refuses what is not computed', () => {
    expect(parseFontSizePx('16px')).toBe(16);
    expect(parseFontSizePx(' 18.6667px ')).toBeCloseTo(18.6667, 4);
    expect(parseFontSizePx('1em')).toBeNull();
    expect(parseFontSizePx('medium')).toBeNull();
    expect(parseFontSizePx('-1px')).toBeNull();
    expect(parseFontWeight('400')).toBe(400);
    expect(parseFontWeight('bold')).toBe(700);
    expect(parseFontWeight('normal')).toBe(400);
    expect(parseFontWeight('bolder')).toBeNull();
    expect(parseFontWeight('0')).toBeNull();
    expect(parseFontWeight('1001')).toBeNull();
  });
});

describe('properties that must hold for any colour', () => {
  const channel = fc.integer({ min: 0, max: 255 });
  const alpha = fc.integer({ min: 0, max: 1000 }).map((n) => n / 1000);
  const opaque = fc.tuple(channel, channel, channel).map(([r, g, b]) => rgba(r, g, b));
  const any = fc.tuple(channel, channel, channel, alpha).map(([r, g, b, a]) => rgba(r, g, b, a));

  it('ratio is symmetric and lies in [1, 21]', () => {
    fc.assert(
      fc.property(opaque, opaque, (a, b) => {
        const ratio = contrastRatio(a, b);
        expect(ratio).toBeCloseTo(contrastRatio(b, a), 10);
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21 + 1e-9);
      }),
      { numRuns: 500 },
    );
  });

  it('compositing an opaque colour is the identity on the result', () => {
    fc.assert(
      fc.property(opaque, any, (top, backdrop) => {
        expect(over(top, backdrop)).toEqual(top);
      }),
      { numRuns: 500 },
    );
  });

  it('compositing alpha zero returns the backdrop', () => {
    fc.assert(
      fc.property(opaque, any, (top, backdrop) => {
        const result = over({ ...top, a: 0 }, backdrop);
        if (backdrop.a === 0) expect(result).toEqual(TRANSPARENT);
        else close(result, backdrop, 1e-9);
      }),
      { numRuns: 500 },
    );
  });

  it('composites associatively: (a over b) over c equals a over (b over c)', () => {
    fc.assert(
      fc.property(any, any, opaque, (a, b, c) => {
        close(over(over(a, b), c), over(a, over(b, c)), 1e-6);
      }),
      { numRuns: 500 },
    );
  });

  it('round-trips through the format it emits', () => {
    fc.assert(
      fc.property(any, (colour) => {
        close(parsed(formatColour(colour)), colour, 0);
      }),
      { numRuns: 500 },
    );
  });

  it('round-trips hex and the modern rgb syntax for integer channels', () => {
    fc.assert(
      fc.property(opaque, (colour) => {
        const hex = `#${[colour.r, colour.g, colour.b]
          .map((c) => c.toString(16).padStart(2, '0'))
          .join('')}`;
        expect(parsed(hex)).toEqual(colour);
        expect(parsed(`rgb(${colour.r} ${colour.g} ${colour.b})`)).toEqual(colour);
      }),
      { numRuns: 300 },
    );
  });
});
