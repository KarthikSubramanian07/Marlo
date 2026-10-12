import { describe, expect, it } from 'vitest';
import type { SourceElement } from './parse.js';
import { buildDocument } from './parse.js';
import { fixture } from './fixture.js';

/**
 * The two inputs a rule about rendered text needs beyond the tree: which text is the
 * element's own, and where the element is. Both come from the renderer through
 * `buildDocument`, and both have a fixture equivalent so a rule can be tested without one.
 */

function element(
  nodeName: string,
  children: SourceElement[] = [],
  attributes: { name: string; value: string }[] = [],
): SourceElement {
  return {
    nodeType: 1,
    nodeName,
    childNodes: children,
    attributes,
    textContent: children.map((c) => c.textContent ?? '').join(''),
    outerHTML: `<${nodeName.toLowerCase()}>`,
  };
}

function text(content: string): SourceElement {
  return { nodeType: 3, nodeName: '#text', childNodes: [], textContent: content };
}

describe('buildDocument', () => {
  it('separates an element’s own text from its descendants’ text', () => {
    const p = element('P', [text('Hello '), element('B', [text('there')]), text('!')]);
    const document = buildDocument(element('HTML', [element('BODY', [p])]), {
      url: 'https://marlo.invalid/',
      hasDoctype: true,
      computedStyleFor: null,
      boxFor: null,
    });
    const body = document.root.children[0];
    const paragraph = body?.children[0];
    expect(paragraph?.text).toBe('Hello there!');
    expect(paragraph?.ownText).toBe('Hello !');
    expect(paragraph?.children[0]?.ownText).toBe('there');
    expect(body?.ownText).toBe('');
  });

  it('carries no geometry when the renderer offers none, and the box when it does', () => {
    const root = element('HTML', [element('BODY', [element('P', [text('x')])])]);
    const without = buildDocument(root, {
      url: 'https://marlo.invalid/',
      hasDoctype: true,
      computedStyleFor: null,
      boxFor: null,
    });
    expect(without.root.box).toBeNull();
    expect(without.root.children[0]?.children[0]?.box).toBeNull();

    const with_ = buildDocument(root, {
      url: 'https://marlo.invalid/',
      hasDoctype: true,
      computedStyleFor: null,
      boxFor: (source) => (source.nodeName === 'P' ? { x: 8, y: 8, width: 100, height: 20 } : null),
    });
    expect(with_.root.box).toBeNull();
    expect(with_.root.children[0]?.children[0]?.box).toEqual({
      x: 8,
      y: 8,
      width: 100,
      height: 20,
    });
  });
});

describe('fixture', () => {
  it('assigns own text to the innermost open element only', () => {
    const document = fixture('<html><body><p id="p">Hello <b>there</b> again</p></body></html>');
    const p = document.root.children[0]?.children[0];
    expect(p?.text).toBe('Hello there again');
    expect(p?.ownText).toBe('Hello  again');
    expect(p?.children[0]?.ownText).toBe('there');
  });

  it('supplies boxes by selector the same way it supplies computed styles', () => {
    const document = fixture('<html><body><p id="p">x</p><p>y</p></body></html>', {
      boxes: { '#p': { x: 0, y: 0, width: 50, height: 10 } },
    });
    const [first, second] = document.root.children[0]?.children ?? [];
    expect(first?.box).toEqual({ x: 0, y: 0, width: 50, height: 10 });
    expect(second?.box).toBeNull();
    expect(first?.computed).toBeNull();
  });
});
