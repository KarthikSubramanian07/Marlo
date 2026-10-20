import { describe, expect, it } from 'vitest';
import { hasActiveContent, hygieneProblems, markupOf } from './snapshot-hygiene.mjs';

const head =
  '<!doctype html>\n<!-- marlo-snapshot: url https://example.com/; retrieved 2026-10-20; -->\n';

describe('snapshot hygiene', () => {
  it('passes a clean page', () => {
    expect(hygieneProblems('p', `${head}<html><body><p>hi</p></body></html>`)).toEqual([]);
  });

  it('refuses a script element and an inline handler anywhere in the markup', () => {
    expect(hygieneProblems('p', `${head}<body><script src="x.js"></script></body>`)).toEqual([
      'p: contains a <script> element.',
    ]);
    expect(
      hygieneProblems('p', `${head}<input placeholder="Search" onfocus="this.value=''">`),
    ).toEqual(['p: contains an inline event handler attribute.']);
    expect(hasActiveContent('<div class="x"\n onclick="go()">')).toBe(true);
  });

  it('does not read text inside a style element or a comment as markup', () => {
    const css = '<style>/* wraps around <script embeds.js> from a widget */ .a { }</style>';
    expect(hygieneProblems('p', `${head}${css}<p>ok</p>`)).toEqual([]);
    expect(hasActiveContent('<!-- <button onclick="x()"> -->')).toBe(false);
    expect(markupOf('<style media="print">a{}</style><b>')).toBe('<style></style><b>');
  });

  it('still refuses a real element after a style block', () => {
    expect(hasActiveContent('<style>p{}</style><a href="#" onmouseover="x()">')).toBe(true);
    expect(hasActiveContent('<style>p{}</style><script>1</script>')).toBe(true);
  });

  it('checks the doctype and the provenance line', () => {
    expect(hygieneProblems('p', '<html></html>')).toEqual([
      'p: the first line is not a doctype.',
      'p: the second line is not the marlo-snapshot provenance comment.',
    ]);
  });
});
