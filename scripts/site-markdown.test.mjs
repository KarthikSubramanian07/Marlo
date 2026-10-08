import { describe, expect, it } from 'vitest';
import { markdownForPage } from '../apps/site/src/markdown.mjs';

describe('page Markdown representation', () => {
  it('preserves headings, examples, semantic tables and absolute links', () => {
    const markdown = markdownForPage({
      origin: 'https://trymarlo.pages.dev/docs/',
      body: '<h1>Marlo</h1><p>Evidence &amp; limits. <a href="/rules/">Rules</a></p><h2>Example</h2><pre><code>marlo scan file.html --json\n</code></pre><table><thead><tr><th>Engine</th><th>Evidence</th></tr></thead><tbody><tr><td>Marlo</td><td>Measured</td></tr></tbody></table>',
    });
    expect(markdown).toContain('# Marlo');
    expect(markdown).toContain('Evidence & limits.');
    expect(markdown).toContain('[Rules](https://trymarlo.pages.dev/rules/)');
    expect(markdown).toContain('```\nmarlo scan file.html --json\n```');
    expect(markdown).toMatch(/\| Engine \| Evidence \|/);
    expect(markdown).toMatch(/\| Marlo \| Measured \|/);
  });
  it('omits decoration and interactive controls without discarding reader content', () => {
    const markdown = markdownForPage({
      origin: 'https://trymarlo.pages.dev/',
      body: '<h1>Marlo</h1><svg><text>decoration</text></svg><label>Filter</label><input><p>Measured evidence.</p>',
    });
    expect(markdown).toBe('# Marlo\n\nMeasured evidence.\n');
  });
});
