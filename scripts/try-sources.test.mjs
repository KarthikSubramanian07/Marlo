import { describe, expect, it } from 'vitest';
import {
  REPO_FILE_LIMIT,
  charsetOf,
  classifyInput,
  looksScriptRendered,
  pickHtmlFiles,
  withBase,
} from '../apps/site/src/try/sources.mjs';

describe('what was typed into the address box', () => {
  it.each([
    ['', { kind: 'empty' }],
    ['example.com', { kind: 'url', url: 'https://example.com/' }],
    ['http://example.com/a?b=1', { kind: 'url', url: 'http://example.com/a?b=1' }],
    ['<p>hi</p>', { kind: 'html' }],
    ['localhost', { kind: 'invalid', reason: expect.any(String) }],
    [
      'https://github.com/w3c/wai-website',
      { kind: 'repo', owner: 'w3c', repo: 'wai-website', ref: null, path: '' },
    ],
    [
      'github.com/KarthikSubramanian07/Marlo/tree/main/apps/demo/',
      {
        kind: 'repo',
        owner: 'KarthikSubramanian07',
        repo: 'Marlo',
        ref: 'main',
        path: 'apps/demo',
      },
    ],
    ['github.com/a/b.git', { kind: 'repo', owner: 'a', repo: 'b', ref: null, path: '' }],
  ])('%s', (input, expected) => {
    expect(classifyInput(input)).toEqual(expected);
  });
});

describe('choosing a repository’s HTML files', () => {
  const blob = (path) => ({ type: 'blob', path });
  it('keeps the folder asked for, skips dependencies and tests, and puts index pages first', () => {
    const tree = [
      blob('docs/b.html'),
      blob('docs/index.html'),
      blob('docs/deep/x.htm'),
      blob('node_modules/pkg/readme.html'),
      blob('docs/tests/fixture.html'),
      blob('other/a.html'),
      blob('docs/style.css'),
      { type: 'tree', path: 'docs/sub.html' },
    ];
    expect(pickHtmlFiles(tree, 'docs')).toEqual({
      files: ['docs/index.html', 'docs/b.html', 'docs/deep/x.htm'],
      total: 3,
    });
  });

  it('opens at most the limit the page describes in words', () => {
    expect(REPO_FILE_LIMIT).toBe(25);
    const tree = Array.from({ length: 40 }, (_, i) => blob(`p${String(i).padStart(2, '0')}.html`));
    const picked = pickHtmlFiles(tree);
    expect(picked.files).toHaveLength(25);
    expect(picked.total).toBe(40);
  });
});

describe('markup handling', () => {
  it('reads the declared charset', () => {
    expect(charsetOf('text/html; charset=ISO-8859-1')).toBe('iso-8859-1');
    expect(charsetOf('text/html')).toBe('utf-8');
    expect(charsetOf(null)).toBe('utf-8');
  });

  it('puts the base after the doctype and leaves a page with its own base alone', () => {
    expect(withBase('<!doctype html><p>', 'https://a.example/')).toBe(
      '<!doctype html><base href="https://a.example/"><p>',
    );
    expect(withBase('<p>', 'https://a.example/')).toBe('<base href="https://a.example/"><p>');
    expect(withBase('<base href="/x/"><p>', 'https://a.example/')).toBe('<base href="/x/"><p>');
  });

  it('spots a page that builds itself with script', () => {
    expect(looksScriptRendered('<div id=root></div><script src=app.js></script>', '')).toBe(true);
    expect(looksScriptRendered('<p>plenty</p>', 'x'.repeat(500))).toBe(false);
  });
});
