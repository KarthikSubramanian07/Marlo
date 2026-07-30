/**
 * A structural DOM view, hand-written.
 *
 * @marlo/rules is a pure package: no filesystem, no network, no DOM library. A rule is
 * a function over these interfaces, which means it can be run against a fixture built
 * by hand in a test without a renderer anywhere. That is what makes the contribution
 * path "one rule, one function, one fixture set" true rather than aspirational.
 *
 * It also means a rule cannot reach for a browser API that only one renderer provides.
 * If a rule needs a computed style it has to ask through `ComputedStyle`, which is
 * `null` unless the renderer supplied `layout`, and the capability model refuses the
 * rule rather than letting it read a value that does not describe what a user sees.
 */

export interface MarloElement {
  /** Lower-case tag name. Normalised on construction so rules need not remember. */
  readonly tag: string;
  /** Attributes with lower-case names, in document order. Duplicates preserved. */
  readonly attributes: readonly MarloAttribute[];
  readonly children: readonly MarloElement[];
  readonly parent: MarloElement | null;
  /** Concatenated descendant text, in document order. */
  readonly text: string;
  /** Byte range in the original source, if the parser recorded one. */
  readonly range: { readonly start: number; readonly end: number } | null;
  /** Serialised form, for evidence in a report. */
  readonly outerHTML: string;
  /**
   * Resolved styles, or null when the renderer provided no `layout` capability.
   *
   * Null rather than an empty object, so a rule reading it has to handle the absence
   * and cannot accidentally treat "no layout" as "no styles set".
   */
  readonly computed: ComputedStyle | null;
}

export interface MarloAttribute {
  readonly name: string;
  readonly value: string;
  /** Byte range of the whole `name="value"` construct, for surgical edits. */
  readonly range: { readonly start: number; readonly end: number } | null;
}

export interface ComputedStyle {
  get(property: string): string | null;
}

/** The document, plus the facts rules need that are not in the tree. */
export interface MarloDocument {
  readonly root: MarloElement;
  /** The URL the document believes it is at. Same-page link rules need it. */
  readonly url: string;
  /** Whether the source declared a doctype. Some rules scope to HTML documents. */
  readonly hasDoctype: boolean;
}

export function attr(element: MarloElement, name: string): string | null {
  const lower = name.toLowerCase();
  for (const a of element.attributes) if (a.name === lower) return a.value;
  return null;
}

export function hasAttr(element: MarloElement, name: string): boolean {
  return attr(element, name) !== null;
}

export function attrNode(element: MarloElement, name: string): MarloAttribute | null {
  const lower = name.toLowerCase();
  for (const a of element.attributes) if (a.name === lower) return a;
  return null;
}

/** Depth-first, document order, including the starting element. */
export function* walk(element: MarloElement): Generator<MarloElement> {
  yield element;
  for (const child of element.children) yield* walk(child);
}

export function descendants(element: MarloElement): MarloElement[] {
  return [...walk(element)].slice(1);
}

export function ancestors(element: MarloElement): MarloElement[] {
  const out: MarloElement[] = [];
  let current = element.parent;
  while (current !== null) {
    out.push(current);
    current = current.parent;
  }
  return out;
}

export function findAll(document: MarloDocument, tags: readonly string[]): MarloElement[] {
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  return [...walk(document.root)].filter((e) => wanted.has(e.tag));
}

export function findFirst(document: MarloDocument, tag: string): MarloElement | null {
  const lower = tag.toLowerCase();
  for (const element of walk(document.root)) if (element.tag === lower) return element;
  return null;
}

/**
 * Whether an element is hidden from assistive technology.
 *
 * Deliberately conservative and deliberately incomplete. It covers what is decidable
 * from the DOM alone: `hidden`, `aria-hidden="true"`, `display:none` or
 * `visibility:hidden` in a style attribute, an ancestor with any of those, and the
 * `<template>` and `<head>` subtrees.
 *
 * What it cannot see is a class in a stylesheet that hides the element. That is a
 * `layout` question, and a rule whose correctness depends on it must declare `layout`
 * rather than relying on this. Getting that wrong produces a false positive on an
 * element nobody can reach, which is the most annoying kind of false positive because
 * the developer looks at the page and sees nothing wrong.
 */
export function isHiddenFromAssistiveTech(element: MarloElement): boolean {
  for (const node of [element, ...ancestors(element)]) {
    if (node.tag === 'template' || node.tag === 'head') return true;
    if (hasAttr(node, 'hidden')) return true;
    if (attr(node, 'aria-hidden') === 'true') return true;
    const style = attr(node, 'style');
    if (
      style !== null &&
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/i.test(style)
    ) {
      return true;
    }
    const computed = node.computed?.get('display');
    if (computed === 'none') return true;
  }
  return false;
}

/** Focusable by default, or made focusable by a non-negative tabindex. */
export function isFocusable(element: MarloElement): boolean {
  const tabindex = attr(element, 'tabindex');
  if (tabindex !== null) {
    const parsed = Number.parseInt(tabindex, 10);
    if (!Number.isNaN(parsed)) return parsed >= 0;
  }
  if (hasAttr(element, 'disabled')) return false;
  switch (element.tag) {
    case 'a':
    case 'area':
      return hasAttr(element, 'href');
    case 'button':
    case 'input':
    case 'select':
    case 'textarea':
    case 'summary':
      return true;
    case 'audio':
    case 'video':
      return hasAttr(element, 'controls');
    default:
      return false;
  }
}

/** Normalises whitespace the way accessible name computation requires. */
export function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
