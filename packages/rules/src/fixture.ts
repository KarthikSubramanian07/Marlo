import type { ComputedStyle, MarloDocument, MarloElement } from './dom.js';

/**
 * Builds a `MarloDocument` from a tiny markup description, for tests.
 *
 * Not an HTML parser and not trying to be. It handles the shapes a rule fixture needs:
 * nested elements, attributes with double or single quotes or none, void elements, and
 * text. A fixture that needs more than this is probably testing the parser rather than
 * the rule, and the official ACT test cases go through a real renderer in the
 * calibration harness.
 *
 * The reason it exists at all: a rule test that needs a renderer is a rule test a
 * contributor cannot write in isolation, and the contribution funnel depends on them
 * being able to.
 */

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

interface Building {
  tag: string;
  attributes: { name: string; value: string; range: null }[];
  children: MarloElement[];
  parent: MarloElement | null;
  text: string;
  range: null;
  outerHTML: string;
  computed: ComputedStyle | null;
}

function parseAttributes(raw: string): { name: string; value: string; range: null }[] {
  const out: { name: string; value: string; range: null }[] = [];
  const pattern = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const name = (match[1] ?? '').toLowerCase();
    if (name === '') continue;
    out.push({ name, value: match[2] ?? match[3] ?? match[4] ?? '', range: null });
  }
  return out;
}

/**
 * `computed` supplies resolved styles per selector, for the rare fixture that needs to
 * exercise a layout-dependent path. Absent means no layout, which is the default and
 * the honest one.
 */
export interface FixtureOptions {
  readonly url?: string;
  readonly computed?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export function fixture(html: string, options: FixtureOptions = {}): MarloDocument {
  const hasDoctype = /^\s*<!doctype/i.test(html);
  const body = html.replace(/^\s*<!doctype[^>]*>/i, '');

  const root: Building = {
    tag: 'html',
    attributes: [],
    children: [],
    parent: null,
    text: '',
    range: null,
    outerHTML: body,
    computed: null,
  };

  const stack: Building[] = [root];
  let explicitRoot = false;
  const tokens = body.matchAll(/<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>|([^<]+)/g);

  for (const token of tokens) {
    const [, tagName, rawAttributes, text] = token;

    if (text !== undefined) {
      const trimmed = text.replace(/\s+/g, ' ');
      if (trimmed.trim() !== '') {
        const current = stack[stack.length - 1];
        if (current !== undefined) current.text += trimmed;
      }
      continue;
    }
    if (tagName === undefined) continue;

    const tag = tagName.toLowerCase();
    const closing = token[0].startsWith('</');

    if (closing) {
      // Unwind to the matching open tag. A stray close tag is ignored, which is what a
      // browser does.
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i]?.tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const attributes = parseAttributes(rawAttributes ?? '');

    if (tag === 'html' && !explicitRoot && stack.length === 1) {
      // An explicit html element becomes the root rather than a child of the implicit
      // one, so `findFirst(document, 'html')` finds the author's element with its
      // attributes.
      root.attributes = attributes;
      root.outerHTML = token[0];
      explicitRoot = true;
      continue;
    }

    const parent = stack[stack.length - 1];
    if (parent === undefined) continue;

    const element: Building = {
      tag,
      attributes,
      children: [],
      parent,
      text: '',
      range: null,
      outerHTML: token[0],
      computed: null,
    };
    parent.children.push(element);
    if (!VOID_ELEMENTS.has(tag) && !token[0].endsWith('/>')) stack.push(element);
  }

  // Text propagates upward, because `element.text` is defined as concatenated
  // descendant text.
  const rollUp = (node: Building): string => {
    let own = node.text;
    for (const child of node.children) own += rollUp(child as Building);
    node.text = own;
    return own;
  };
  rollUp(root);

  // Resolved styles, where the fixture asked for them.
  if (options.computed !== undefined) {
    const styles = options.computed;
    const apply = (node: Building): void => {
      const id = node.attributes.find((a) => a.name === 'id')?.value;
      const key = id !== undefined && id !== '' ? `#${id}` : node.tag;
      const declared = styles[key];
      if (declared !== undefined) {
        node.computed = { get: (property) => declared[property] ?? null };
      }
      for (const child of node.children) apply(child as Building);
    };
    apply(root);
  }

  return { root, url: options.url ?? 'https://marlo.invalid/', hasDoctype };
}
