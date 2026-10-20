/**
 * Finds the `@import` rules in a stylesheet, for the snapshot script to replace in place.
 *
 * A quoted URL runs to its closing quote, not to the first semicolon. Google Fonts URLs
 * carry semicolons inside the query (`wght@0,14..32,100..900;1,14..32,100..900`), and an
 * earlier pattern stopped there: it inlined the fonts and left the rest of the URL behind
 * as stray text that opened a CSS string, so the browser dropped every rule after it and
 * the page was vendored almost unstyled.
 *
 * Returns each rule's full text, its URL and its media query, in source order.
 */
const IMPORT =
  /@import\s+(?:url\(\s*(["'])(.*?)\1\s*\)|url\(\s*([^"'()\s]+)\s*\)|(["'])(.*?)\4)([^;]*);/gis;

export function findImports(css) {
  return [...css.matchAll(IMPORT)].map((m) => ({
    text: m[0],
    url: m[2] ?? m[3] ?? m[5] ?? '',
    media: (m[6] ?? '').trim(),
  }));
}
