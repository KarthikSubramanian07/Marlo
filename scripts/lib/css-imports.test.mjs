import { describe, expect, it } from 'vitest';
import { findImports } from './css-imports.mjs';

describe('findImports', () => {
  it('reads every quoting style, with and without a media query', () => {
    const css =
      '@import url("a.css");\n@import url(\'b.css\') print;\n@import url(c.css) screen and (min-width: 40em);\n@import "d.css";\n@import \'e.css\' print;\nbody { color: red }';
    expect(findImports(css).map((i) => [i.url, i.media])).toEqual([
      ['a.css', ''],
      ['b.css', 'print'],
      ['c.css', 'screen and (min-width: 40em)'],
      ['d.css', ''],
      ['e.css', 'print'],
    ]);
  });

  it('keeps a semicolon inside a quoted URL as part of the URL', () => {
    const url =
      'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap';
    const css = `@import url("${url}");@font-face{font-family:Inter}html{margin:0}`;
    const [found] = findImports(css);
    expect(found?.url).toBe(url);
    expect(found?.text).toBe(`@import url("${url}");`);
    // Replacing the rule leaves the rest of the sheet intact, with nothing stray before it.
    expect(css.replace(found?.text ?? '', '/* fonts */')).toBe(
      '/* fonts */@font-face{font-family:Inter}html{margin:0}',
    );
  });

  it('finds nothing in a sheet without imports', () => {
    expect(findImports('a { background: url("x;y.png") }')).toEqual([]);
  });
});
