/**
 * What a vendored page snapshot promises, as one check shared by the script that writes
 * snapshots and the script that verifies them, so the two cannot disagree about what a
 * clean page is. No dependencies: the CI corpus job runs the verifier with bare `node`.
 *
 * Markup is searched with the contents of `<style>` elements and of comments taken out
 * first. Both are text to the parser, so `<script` inside a CSS comment is not a script
 * element, and a page whose stylesheet mentions one must not be refused for it. Nothing
 * else is exempt.
 */

const STYLE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;

export const SCRIPT_ELEMENT = /<script\b/i;
export const INLINE_HANDLER = /<[a-z][a-z0-9-]*\s(?:[^>]*\s)?on[a-z]+\s*=/i;

/** The markup a parser would read as elements: style contents and comments removed. */
export function markupOf(html) {
  return html.replace(STYLE, '<style></style>').replace(COMMENT, '');
}

/** Every way a snapshot breaks its promises, as sentences naming the page. */
export function hygieneProblems(id, html) {
  const found = [];
  const lines = html.split('\n', 3);
  const first = lines[0] ?? '';
  const second = lines[1] ?? '';
  if (!/^<!doctype /i.test(first)) found.push(`${id}: the first line is not a doctype.`);
  if (!second.startsWith('<!-- marlo-snapshot: url ')) {
    found.push(`${id}: the second line is not the marlo-snapshot provenance comment.`);
  }
  const markup = markupOf(html);
  if (SCRIPT_ELEMENT.test(markup)) found.push(`${id}: contains a <script> element.`);
  if (INLINE_HANDLER.test(markup)) found.push(`${id}: contains an inline event handler attribute.`);
  return found;
}

/** Whether serialised markup still carries a script element or an inline handler. */
export function hasActiveContent(html) {
  const markup = markupOf(html);
  return SCRIPT_ELEMENT.test(markup) || INLINE_HANDLER.test(markup);
}
