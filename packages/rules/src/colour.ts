/**
 * Colour arithmetic for the contrast rules.
 *
 * Pure, like the rest of the package: strings in, numbers out, no DOM anywhere. The
 * three jobs here are the three places a contrast ratio goes wrong when done casually.
 *
 * Parsing. A browser's `getComputedStyle` returns `rgb()` and `rgba()` almost always,
 * but a renderer may hand over whatever the author wrote, and a modern browser returns
 * `color(srgb ...)`, `lab()` or `oklch()` for a colour declared that way. Everything
 * this module cannot convert exactly parses to `unsupported`, carrying the original
 * string, so a rule reports what it could not read instead of substituting a guess.
 *
 * Compositing. `rgba(0, 0, 0, 0.3)` over white is not black, and the composite happens
 * in gamma-encoded sRGB because that is what CSS does by default. Linearising first
 * would give a different, wrong number.
 *
 * Luminance and ratio. WCAG's formulas, with the 0.04045 linearisation threshold from
 * the 2.2 text rather than the 0.03928 figure the 2.0 text carried. The difference is
 * below the second decimal place of any ratio, and the newer constant is the one the
 * published errata settled on.
 */

/** A colour in sRGB. Channels in [0, 255], not necessarily integers; alpha in [0, 1]. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * What a colour string parsed to.
 *
 * `currentcolor` is a marker rather than a colour: it means the element's own `color`,
 * which the caller has and this module does not. `unsupported` keeps the input so the
 * message can show the developer what was not understood.
 */
export type ParsedColour =
  | { readonly kind: 'colour'; readonly value: Rgba }
  | { readonly kind: 'currentcolor' }
  | { readonly kind: 'unsupported'; readonly input: string };

export const TRANSPARENT: Rgba = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
export const WHITE: Rgba = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });
export const BLACK: Rgba = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });

/**
 * The 148 named colours of CSS Color Level 4, as packed 24-bit values. `grey` spellings
 * are separate names in the specification, so they are separate entries here.
 */
const NAMED: Readonly<Record<string, number>> = Object.freeze({
  aliceblue: 0xf0f8ff,
  antiquewhite: 0xfaebd7,
  aqua: 0x00ffff,
  aquamarine: 0x7fffd4,
  azure: 0xf0ffff,
  beige: 0xf5f5dc,
  bisque: 0xffe4c4,
  black: 0x000000,
  blanchedalmond: 0xffebcd,
  blue: 0x0000ff,
  blueviolet: 0x8a2be2,
  brown: 0xa52a2a,
  burlywood: 0xdeb887,
  cadetblue: 0x5f9ea0,
  chartreuse: 0x7fff00,
  chocolate: 0xd2691e,
  coral: 0xff7f50,
  cornflowerblue: 0x6495ed,
  cornsilk: 0xfff8dc,
  crimson: 0xdc143c,
  cyan: 0x00ffff,
  darkblue: 0x00008b,
  darkcyan: 0x008b8b,
  darkgoldenrod: 0xb8860b,
  darkgray: 0xa9a9a9,
  darkgreen: 0x006400,
  darkgrey: 0xa9a9a9,
  darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b,
  darkolivegreen: 0x556b2f,
  darkorange: 0xff8c00,
  darkorchid: 0x9932cc,
  darkred: 0x8b0000,
  darksalmon: 0xe9967a,
  darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b,
  darkslategray: 0x2f4f4f,
  darkslategrey: 0x2f4f4f,
  darkturquoise: 0x00ced1,
  darkviolet: 0x9400d3,
  deeppink: 0xff1493,
  deepskyblue: 0x00bfff,
  dimgray: 0x696969,
  dimgrey: 0x696969,
  dodgerblue: 0x1e90ff,
  firebrick: 0xb22222,
  floralwhite: 0xfffaf0,
  forestgreen: 0x228b22,
  fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc,
  ghostwhite: 0xf8f8ff,
  gold: 0xffd700,
  goldenrod: 0xdaa520,
  gray: 0x808080,
  green: 0x008000,
  greenyellow: 0xadff2f,
  grey: 0x808080,
  honeydew: 0xf0fff0,
  hotpink: 0xff69b4,
  indianred: 0xcd5c5c,
  indigo: 0x4b0082,
  ivory: 0xfffff0,
  khaki: 0xf0e68c,
  lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5,
  lawngreen: 0x7cfc00,
  lemonchiffon: 0xfffacd,
  lightblue: 0xadd8e6,
  lightcoral: 0xf08080,
  lightcyan: 0xe0ffff,
  lightgoldenrodyellow: 0xfafad2,
  lightgray: 0xd3d3d3,
  lightgreen: 0x90ee90,
  lightgrey: 0xd3d3d3,
  lightpink: 0xffb6c1,
  lightsalmon: 0xffa07a,
  lightseagreen: 0x20b2aa,
  lightskyblue: 0x87cefa,
  lightslategray: 0x778899,
  lightslategrey: 0x778899,
  lightsteelblue: 0xb0c4de,
  lightyellow: 0xffffe0,
  lime: 0x00ff00,
  limegreen: 0x32cd32,
  linen: 0xfaf0e6,
  magenta: 0xff00ff,
  maroon: 0x800000,
  mediumaquamarine: 0x66cdaa,
  mediumblue: 0x0000cd,
  mediumorchid: 0xba55d3,
  mediumpurple: 0x9370db,
  mediumseagreen: 0x3cb371,
  mediumslateblue: 0x7b68ee,
  mediumspringgreen: 0x00fa9a,
  mediumturquoise: 0x48d1cc,
  mediumvioletred: 0xc71585,
  midnightblue: 0x191970,
  mintcream: 0xf5fffa,
  mistyrose: 0xffe4e1,
  moccasin: 0xffe4b5,
  navajowhite: 0xffdead,
  navy: 0x000080,
  oldlace: 0xfdf5e6,
  olive: 0x808000,
  olivedrab: 0x6b8e23,
  orange: 0xffa500,
  orangered: 0xff4500,
  orchid: 0xda70d6,
  palegoldenrod: 0xeee8aa,
  palegreen: 0x98fb98,
  paleturquoise: 0xafeeee,
  palevioletred: 0xdb7093,
  papayawhip: 0xffefd5,
  peachpuff: 0xffdab9,
  peru: 0xcd853f,
  pink: 0xffc0cb,
  plum: 0xdda0dd,
  powderblue: 0xb0e0e6,
  purple: 0x800080,
  rebeccapurple: 0x663399,
  red: 0xff0000,
  rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1,
  saddlebrown: 0x8b4513,
  salmon: 0xfa8072,
  sandybrown: 0xf4a460,
  seagreen: 0x2e8b57,
  seashell: 0xfff5ee,
  sienna: 0xa0522d,
  silver: 0xc0c0c0,
  skyblue: 0x87ceeb,
  slateblue: 0x6a5acd,
  slategray: 0x708090,
  slategrey: 0x708090,
  snow: 0xfffafa,
  springgreen: 0x00ff7f,
  steelblue: 0x4682b4,
  tan: 0xd2b48c,
  teal: 0x008080,
  thistle: 0xd8bfd8,
  tomato: 0xff6347,
  turquoise: 0x40e0d0,
  violet: 0xee82ee,
  wheat: 0xf5deb3,
  white: 0xffffff,
  whitesmoke: 0xf5f5f5,
  yellow: 0xffff00,
  yellowgreen: 0x9acd32,
});

/** The names this module knows, for a test that counts them. */
export const NAMED_COLOUR_COUNT = Object.keys(NAMED).length;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function packed(value: number, alpha = 1): Rgba {
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff, a: alpha };
}

function colour(r: number, g: number, b: number, a: number): ParsedColour {
  return {
    kind: 'colour',
    value: { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) },
  };
}

function unsupported(input: string): ParsedColour {
  return { kind: 'unsupported', input };
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * A channel component: a plain number, a percentage scaled to `scale`, or the Color 4
 * keyword `none`, which is zero for every channel it can stand in for. Null when the
 * token is none of those.
 */
function component(token: string, scale: number): number | null {
  if (token === 'none') return 0;
  if (token.endsWith('%')) {
    const body = token.slice(0, -1);
    return NUMBER.test(body) ? (Number(body) / 100) * scale : null;
  }
  return NUMBER.test(token) ? Number(token) : null;
}

/** An alpha component: a number in [0, 1] or a percentage. */
function alphaComponent(token: string): number | null {
  if (token === 'none') return 0;
  if (token.endsWith('%')) {
    const body = token.slice(0, -1);
    return NUMBER.test(body) ? Number(body) / 100 : null;
  }
  return NUMBER.test(token) ? Number(token) : null;
}

/**
 * Splits the arguments of a functional colour into channel tokens and an alpha token.
 *
 * Both syntaxes are accepted: the legacy comma form `rgba(0, 0, 0, 0.5)` and the modern
 * space form `rgb(0 0 0 / 0.5)`. Mixing them is a parse error in CSS and is one here.
 */
type Triple = readonly [string, string, string];

function tripleOf(parts: readonly string[]): Triple | null {
  const [a, b, c] = parts;
  if (parts.length !== 3 || a === undefined || b === undefined || c === undefined) return null;
  return [a, b, c];
}

function splitArguments(body: string): { channels: Triple; alpha: string | null } | null {
  const trimmed = body.trim();
  if (trimmed === '') return null;
  if (trimmed.includes(',')) {
    if (trimmed.includes('/')) return null;
    const parts = trimmed.split(',').map((p) => p.trim());
    if (parts.some((p) => p === '' || /\s/.test(p))) return null;
    if (parts.length === 4) {
      const channels = tripleOf(parts.slice(0, 3));
      return channels === null ? null : { channels, alpha: parts[3] ?? null };
    }
    const channels = tripleOf(parts);
    return channels === null ? null : { channels, alpha: null };
  }
  const slash = trimmed.split('/');
  if (slash.length > 2) return null;
  const channels = tripleOf((slash[0] ?? '').trim().split(/\s+/));
  if (channels === null) return null;
  if (slash.length === 1) return { channels, alpha: null };
  const alpha = (slash[1] ?? '').trim();
  if (alpha === '' || /\s/.test(alpha)) return null;
  return { channels, alpha };
}

/** Three channel components at one scale, or null if any token is not a component. */
function components(channels: Triple, scale: number): readonly [number, number, number] | null {
  const r = component(channels[0], scale);
  const g = component(channels[1], scale);
  const b = component(channels[2], scale);
  if (r === null || g === null || b === null) return null;
  return [r, g, b];
}

function parseHex(hex: string): ParsedColour | null {
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  const pair = (text: string): number => Number.parseInt(text, 16);
  const single = (index: number): number => pair(hex.charAt(index).repeat(2));
  switch (hex.length) {
    case 3:
    case 4:
      return colour(single(0), single(1), single(2), hex.length === 4 ? single(3) / 255 : 1);
    case 6:
    case 8:
      return colour(
        pair(hex.slice(0, 2)),
        pair(hex.slice(2, 4)),
        pair(hex.slice(4, 6)),
        hex.length === 8 ? pair(hex.slice(6, 8)) / 255 : 1,
      );
    default:
      return null;
  }
}

function parseRgbFunction(body: string, input: string): ParsedColour {
  const split = splitArguments(body);
  if (split === null) return unsupported(input);
  const channels = components(split.channels, 255);
  if (channels === null) return unsupported(input);
  const a = split.alpha === null ? 1 : alphaComponent(split.alpha);
  if (a === null) return unsupported(input);
  return colour(channels[0], channels[1], channels[2], a);
}

/** A hue in degrees from a CSS angle token. Unitless numbers are degrees. */
function hue(token: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i.exec(token);
  if (match === null) return token === 'none' ? 0 : null;
  const value = Number(match[1]);
  switch ((match[2] ?? 'deg').toLowerCase()) {
    case 'grad':
      return value * 0.9;
    case 'rad':
      return (value * 180) / Math.PI;
    case 'turn':
      return value * 360;
    default:
      return value;
  }
}

/** CSS Color 4's hsl to rgb conversion, which is the HTML5 one with the hue normalised. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hueNormalised = (((h % 360) + 360) % 360) / 30;
  const saturation = clamp(s, 0, 1);
  const lightness = clamp(l, 0, 1);
  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = (n: number): number => {
    const k = (n + hueNormalised) % 12;
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function parseHslFunction(body: string, input: string): ParsedColour {
  const split = splitArguments(body);
  if (split === null) return unsupported(input);
  const [hToken, sToken, lToken] = split.channels;
  const h = hue(hToken);
  // Saturation and lightness are percentages in the legacy syntax and may be bare
  // numbers meaning percentages in the modern one.
  const s = component(sToken, 100);
  const l = component(lToken, 100);
  if (h === null || s === null || l === null) return unsupported(input);
  const a = split.alpha === null ? 1 : alphaComponent(split.alpha);
  if (a === null) return unsupported(input);
  const [r, g, b] = hslToRgb(h, s / 100, l / 100);
  return colour(r, g, b, a);
}

/** `color(srgb r g b / a)` only. Any other colour space is reported, not converted. */
function parseColorFunction(body: string, input: string): ParsedColour {
  const trimmed = body.trim();
  if (!/^srgb\s/.test(trimmed) || trimmed.includes(',')) return unsupported(input);
  const split = splitArguments(trimmed.slice('srgb'.length));
  if (split === null) return unsupported(input);
  const channels = components(split.channels, 1);
  if (channels === null) return unsupported(input);
  const a = split.alpha === null ? 1 : alphaComponent(split.alpha);
  if (a === null) return unsupported(input);
  return colour(channels[0] * 255, channels[1] * 255, channels[2] * 255, a);
}

/**
 * Parses a CSS colour.
 *
 * Accepted: `rgb()` and `rgba()` in legacy and modern syntax, hex in all four lengths,
 * `hsl()` and `hsla()`, `transparent`, the named colours, `currentcolor`, and
 * `color(srgb ...)`. Everything else is `unsupported`: `lab()`, `lch()`, `oklab()`,
 * `oklch()`, `color-mix()`, other `color()` spaces and the system colours. Each of
 * those would need a colour space conversion or a platform lookup that could be done
 * slightly wrong, and a slightly wrong colour is a slightly wrong ratio with no sign
 * that anything is off.
 */
export function parseColour(input: string): ParsedColour {
  const text = input.trim().toLowerCase();
  if (text === '') return unsupported(input);
  if (text === 'transparent') return { kind: 'colour', value: TRANSPARENT };
  if (text === 'currentcolor') return { kind: 'currentcolor' };

  const named = NAMED[text];
  if (named !== undefined) return { kind: 'colour', value: packed(named) };

  if (text.startsWith('#')) return parseHex(text.slice(1)) ?? unsupported(input);

  const open = text.indexOf('(');
  if (open <= 0 || !text.endsWith(')')) return unsupported(input);
  const name = text.slice(0, open);
  const body = text.slice(open + 1, -1);
  switch (name) {
    case 'rgb':
    case 'rgba':
      return parseRgbFunction(body, input);
    case 'hsl':
    case 'hsla':
      return parseHslFunction(body, input);
    case 'color':
      return parseColorFunction(body, input);
    default:
      return unsupported(input);
  }
}

/**
 * Source-over compositing of `top` onto `backdrop`, in gamma-encoded sRGB with
 * straight (non-premultiplied) alpha, which is what CSS does for `background-color`
 * layers and text in the absence of `mix-blend-mode`.
 *
 * The result of compositing onto a fully transparent backdrop with a fully transparent
 * top is transparent black: the colour channels of a zero-alpha pixel carry no
 * information, so they are normalised to zero rather than left as whatever arithmetic
 * produced.
 */
export function over(top: Rgba, backdrop: Rgba): Rgba {
  const alpha = top.a + backdrop.a * (1 - top.a);
  if (alpha === 0) return TRANSPARENT;
  const channel = (t: number, b: number): number =>
    (t * top.a + b * backdrop.a * (1 - top.a)) / alpha;
  return {
    r: channel(top.r, backdrop.r),
    g: channel(top.g, backdrop.g),
    b: channel(top.b, backdrop.b),
    a: alpha,
  };
}

/** Multiplies a colour's alpha, which is what a group `opacity` does to its contents. */
export function scaleAlpha(colour: Rgba, factor: number): Rgba {
  return { ...colour, a: colour.a * clamp(factor, 0, 1) };
}

function linearise(channel: number): number {
  const c = clamp(channel, 0, 255) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance. Alpha is ignored: a translucent colour has no luminance of
 * its own until it is composited onto something, so callers composite first.
 */
export function relativeLuminance(colour: Rgba): number {
  return 0.2126 * linearise(colour.r) + 0.7152 * linearise(colour.g) + 0.0722 * linearise(colour.b);
}

/** WCAG contrast ratio, in [1, 21], symmetric in its arguments. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Formats a colour the way a browser's `getComputedStyle` would: `rgb(r, g, b)` when
 * opaque, `rgba(r, g, b, a)` otherwise. Channels are rounded to integers and alpha to
 * three decimals, which is the precision the messages need and the round trip the
 * tests assert.
 */
export function formatColour(colour: Rgba): string {
  const r = Math.round(clamp(colour.r, 0, 255));
  const g = Math.round(clamp(colour.g, 0, 255));
  const b = Math.round(clamp(colour.b, 0, 255));
  if (colour.a >= 1) return `rgb(${r}, ${g}, ${b})`;
  const a = Number(clamp(colour.a, 0, 1).toFixed(3));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * The 18 point and 14 point bold thresholds of WCAG's "large scale" text, in CSS
 * pixels: 24px, or 18.66px at weight 700 or above. The second figure is 14pt converted
 * at 96 dpi and truncated to two decimals, so a browser reporting `18.6667px` clears it.
 */
export const LARGE_TEXT_PX = 24;
export const LARGE_BOLD_TEXT_PX = 18.66;
export const BOLD_WEIGHT = 700;

export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  if (fontSizePx >= LARGE_TEXT_PX) return true;
  return fontSizePx >= LARGE_BOLD_TEXT_PX && fontWeight >= BOLD_WEIGHT;
}

/**
 * A computed `font-weight` as a number. Browsers return a number, but the keywords are
 * accepted so a fixture can use them. `bolder` and `lighter` are relative to the parent
 * and a computed value never contains them, so they are not resolved here.
 */
export function parseFontWeight(value: string): number | null {
  const text = value.trim().toLowerCase();
  if (text === 'normal') return 400;
  if (text === 'bold') return 700;
  if (!NUMBER.test(text)) return null;
  const weight = Number(text);
  return weight >= 1 && weight <= 1000 ? weight : null;
}

/** A computed `font-size` in CSS pixels. Only `px` is a computed unit. */
export function parseFontSizePx(value: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))px$/i.exec(value.trim());
  if (match === null) return null;
  const size = Number(match[1]);
  return size >= 0 ? size : null;
}
