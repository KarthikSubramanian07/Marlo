import { defineRule } from '../define.js';
import type { RuleVerdict } from '../define.js';
import type { MarloDocument, MarloElement } from '../dom.js';
import {
  ancestors,
  attr,
  findFirst,
  isHiddenFromAssistiveTech,
  isVisuallyHidden,
  normalise,
  walk,
} from '../dom.js';
import { explicitRole } from './aria.js';

/**
 * The bypass blocks family: 047fe0, b40fd1, ye5d6e, and the composite cf77f2 over them.
 *
 * All four turn on one phrase, "non-repeated content after repeated content", and ACT
 * defines a block of repeated content by comparing this page with the pages it links
 * to. Marlo sees one page. So every rule here rests on a heuristic, and the heuristic is
 * the thing to read before trusting a verdict.
 *
 * THE HEURISTIC.
 *
 * Walk the perceivable content of the body in document order. The leading block is the
 * run of content, from the top, that is navigation: text or images inside a link, a
 * placeholder `<a>` with no href, or a `nav` landmark. It ends at the first perceivable
 * thing that is none of those. The leading block counts as repeated content only when it
 * reaches another page, and it is a block rather than a lone link: it holds at least one
 * link to a different host, port or path, and either a second link or a `nav` landmark.
 * Navigation inside a `main` landmark does not count: the author has marked it as page
 * content, and it is usually a breadcrumb trail.
 *
 * After the leading block, content inside a `nav`, a banner, a contentinfo or an `aside`
 * is undecided. A site footer and a sidebar usually repeat, an in-article table of
 * contents and an aside about this article usually do not, and the DOM does not say
 * which. Everything else after the leading block is non-repeated content.
 *
 * WHICH WAY IT IS WRONG.
 *
 * A failure needs a recognised leading block, definite non-repeated content after it,
 * and nothing undecided that could have satisfied the rule. Anything short of that is
 * `cantTell` or a pass. The false positive left is a page whose opening navigation is
 * not repeated anywhere, a two-link "back to results / next result" strip on a page no
 * sibling shares, and it has to have no landmark, heading or skip link that would pass
 * it anyway.
 *
 * The false negatives are larger and chosen. A site header that opens with a text logo
 * rather than a link, a single leading logo link, a heading hidden by a stylesheet
 * class, and a sidebar that really does repeat all come out as `cantTell` or passed.
 * The rules declare only `dom`, like 36b590, so visibility is read from the `hidden`
 * attribute and inline styles and nothing else. A heading moved off-screen by a class
 * reads as visible, which is a miss and never a false finding.
 */

/** A body-scoped landmark that usually repeats from page to page, or null. */
type Region = 'navigation' | 'banner' | 'contentinfo' | 'complementary';

/** Where a node of perceivable content sits, relative to the leading block. */
type Placement = 'leading' | 'undecided' | 'content';

interface PageModel {
  /** Perceivable content in document order. */
  readonly perceivable: readonly MarloElement[];
  /** Position of each perceivable node in `perceivable`. */
  readonly index: ReadonlyMap<MarloElement, number>;
  /** Document order of every element the walk reached. */
  readonly order: ReadonlyMap<MarloElement, number>;
  /** The number of perceivable nodes in the leading block, or 0 when it does not count. */
  readonly leadingLength: number;
  /** The first link in the leading block that reaches another page, when the block counts. */
  readonly leadingLink: MarloElement | null;
  /** Whether anything on the page could lead to another page at all. */
  readonly leadsElsewhere: boolean;
  /** A custom element, whose shadow content this DOM view cannot see. */
  readonly customElement: MarloElement | null;
}

/** Subtrees that never render content a reader perceives. */
const NEVER_CONTENT: ReadonlySet<string> = new Set([
  'head',
  'script',
  'style',
  'template',
  'noscript',
]);

/** Elements that are perceivable content with no text of their own. */
const REPLACED: ReadonlySet<string> = new Set([
  'img',
  'svg',
  'video',
  'canvas',
  'iframe',
  'object',
  'embed',
  'input',
  'select',
  'textarea',
  'meter',
  'progress',
]);

/** Elements whose descendants are part of a single rendered control or graphic. */
const OPAQUE: ReadonlySet<string> = new Set(['svg', 'select', 'object', 'video', 'audio']);

function nonSpaceLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/** Whether an element has text of its own, beyond the text of its child elements. */
function hasOwnText(element: MarloElement): boolean {
  let children = 0;
  for (const child of element.children) children += nonSpaceLength(child.text);
  return nonSpaceLength(element.text) > children;
}

/** The landmark region a node belongs to, per HTML-AAM scoping, or null. */
function regionOf(element: MarloElement): Region | null {
  const role = explicitRole(element);
  if (role === 'navigation' || role === 'banner' || role === 'contentinfo') return role;
  if (role === 'complementary') return role;
  if (role !== null) return null;
  switch (element.tag) {
    case 'nav':
      return 'navigation';
    case 'aside':
      return 'complementary';
    case 'header':
    case 'footer': {
      // A header or footer is a banner or contentinfo only when it is not inside
      // sectioning content or main. Inside an article it belongs to the article.
      const scoped = ancestors(element).some((a) =>
        ['article', 'aside', 'main', 'nav', 'section'].includes(a.tag),
      );
      if (scoped) return null;
      return element.tag === 'header' ? 'banner' : 'contentinfo';
    }
    default:
      return null;
  }
}

function withinRegion(element: MarloElement): Region | null {
  for (const node of [element, ...ancestors(element)]) {
    const region = regionOf(node);
    if (region !== null) return region;
  }
  return null;
}

/** A link, by element or by role. `<a>` with no href is a placeholder link in a menu. */
function isLinkLike(element: MarloElement): boolean {
  if (element.tag === 'a' || element.tag === 'area') return true;
  return explicitRole(element) === 'link';
}

function enclosingLink(element: MarloElement): MarloElement | null {
  for (const node of [element, ...ancestors(element)]) if (isLinkLike(node)) return node;
  return null;
}

interface ParsedUrl {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
}

/**
 * Splits an absolute http or https URL. Written out rather than taken from `URL`,
 * because this package compiles against ES2023 alone, and host, port and path are the
 * only three parts ACT's definition compares.
 */
function parseAbsolute(url: string): ParsedUrl | null {
  const match = /^(https?):\/\/([^/?#]*)([^?#]*)/i.exec(url.trim());
  if (match === null) return null;
  const scheme = (match[1] ?? '').toLowerCase();
  const host = (match[2] ?? '').replace(/^[^@]*@/, '').toLowerCase();
  const authority = host.replace(scheme === 'http' ? /:80$/ : /:443$/, '');
  return { scheme, authority, path: match[3] === '' ? '/' : (match[3] ?? '/') };
}

function removeDotSegments(path: string): string {
  const out: string[] = [];
  const segments = path.split('/');
  segments.forEach((segment, index) => {
    if (segment === '.') {
      if (index === segments.length - 1) out.push('');
      return;
    }
    if (segment === '..') {
      if (out.length > 1) out.pop();
      if (index === segments.length - 1) out.push('');
      return;
    }
    out.push(segment);
  });
  return out.join('/');
}

type Destination =
  | { readonly kind: 'same-page'; readonly fragment: string | null }
  | { readonly kind: 'other-page' }
  | { readonly kind: 'script' }
  | { readonly kind: 'not-a-page' };

/**
 * Where an href leads, compared with the document's own URL. "Another page" is ACT's
 * definition: a different host, port or path. A different query string is the same page.
 */
function destinationOf(href: string, documentUrl: string): Destination {
  const value = href.trim();
  const hash = value.indexOf('#');
  const fragment = hash === -1 ? null : value.slice(hash + 1);
  if (value === '' || value.startsWith('#')) {
    return { kind: 'same-page', fragment };
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme === 'javascript') return { kind: 'script' };
  const base = parseAbsolute(documentUrl);
  let target: ParsedUrl | null;
  if (scheme !== undefined) {
    if (scheme !== 'http' && scheme !== 'https') return { kind: 'not-a-page' };
    target = parseAbsolute(value);
  } else if (base === null) {
    // A relative link from a document with no usable URL. It goes somewhere, and where
    // cannot be compared.
    return { kind: 'other-page' };
  } else if (value.startsWith('//')) {
    target = parseAbsolute(`${base.scheme}:${value}`);
  } else {
    const path = /^[^?#]*/.exec(value)?.[0] ?? '';
    const directory = base.path.slice(0, base.path.lastIndexOf('/') + 1);
    const resolved = path === '' ? base.path : path.startsWith('/') ? path : directory + path;
    target = { ...base, path: removeDotSegments(resolved) };
  }
  if (target === null || base === null) return { kind: 'other-page' };
  const same = target.authority === base.authority && target.path === base.path;
  return same ? { kind: 'same-page', fragment } : { kind: 'other-page' };
}

function linkDestination(link: MarloElement, document: MarloDocument): Destination | null {
  if (link.tag !== 'a' && link.tag !== 'area') return null;
  const href = attr(link, 'href');
  return href === null ? null : destinationOf(href, document.url);
}

/** Whether an element is perceivable content, as far as the DOM can tell. */
function isPerceivable(element: MarloElement): boolean {
  if (isVisuallyHidden(element)) return false;
  if (REPLACED.has(element.tag)) {
    const role = explicitRole(element);
    if (role === 'none' || role === 'presentation') return false;
    if (element.tag === 'input' && (attr(element, 'type') ?? '').toLowerCase() === 'hidden') {
      return false;
    }
    return true;
  }
  if (element.tag === 'audio') return attr(element, 'controls') !== null;
  return hasOwnText(element);
}

const MODELS = new WeakMap<MarloElement, PageModel>();

/** The page model, built once per document and shared by the four rules. */
function modelOf(document: MarloDocument): PageModel {
  const cached = MODELS.get(document.root);
  if (cached !== undefined) return cached;

  const order = new Map<MarloElement, number>();
  const perceivable: MarloElement[] = [];
  let customElement: MarloElement | null = null;
  let leadsElsewhere = false;
  const body = findFirst(document, 'body');

  const visit = (element: MarloElement, inBody: boolean): void => {
    order.set(element, order.size);
    // A script can navigate without any markup saying so.
    if (element.tag === 'script') leadsElsewhere = true;
    if (NEVER_CONTENT.has(element.tag)) return;
    const here = inBody || element === body;
    if (here) {
      if (element.tag.includes('-') && customElement === null) customElement = element;
      if (isPerceivable(element)) perceivable.push(element);
      if (linkDestination(element, document)?.kind === 'other-page') leadsElsewhere = true;
      if (element.tag === 'form' || element.attributes.some((a) => a.name.startsWith('on'))) {
        leadsElsewhere = true;
      }
    }
    if (OPAQUE.has(element.tag)) {
      for (const node of walk(element)) if (!order.has(node)) order.set(node, order.size);
      return;
    }
    for (const child of element.children) visit(child, here);
  };
  visit(document.root, false);

  // The leading block: navigation from the top, up to the first thing that is not.
  let leadingLength = perceivable.length;
  const links = new Set<MarloElement>();
  let inNav = false;
  for (const [position, node] of perceivable.entries()) {
    const link = enclosingLink(node);
    const inNavigation = withinRegion(node) === 'navigation';
    if (link === null && !inNavigation) {
      leadingLength = position;
      break;
    }
    if (link !== null) links.add(link);
    if (inNavigation) inNav = true;
  }
  const otherPage =
    [...links].find((link) => linkDestination(link, document)?.kind === 'other-page') ?? null;
  // A lone link is not a block. "Back to results" on a page nothing else shares is the
  // shape that would otherwise fail, so it takes a second link or a nav to count.
  //
  // Navigation inside a main landmark is, by the author's own markup, part of the page
  // content: a breadcrumb trail or an in-article index rather than site navigation.
  const insideMain =
    otherPage !== null && ancestors(otherPage).some((a) => landmarkRole(a) === 'main');
  const counts = otherPage !== null && (links.size >= 2 || inNav) && !insideMain;

  const model: PageModel = {
    perceivable,
    index: new Map(perceivable.map((node, position) => [node, position])),
    order,
    leadingLength: counts ? leadingLength : 0,
    leadingLink: counts ? otherPage : null,
    leadsElsewhere,
    customElement,
  };
  MODELS.set(document.root, model);
  return model;
}

function contains(ancestor: MarloElement, node: MarloElement): boolean {
  return node === ancestor || ancestors(node).includes(ancestor);
}

/** Where one node of perceivable content sits, relative to a counted leading block. */
function placementOf(model: PageModel, node: MarloElement): Placement {
  const position = model.index.get(node);
  if (position !== undefined && position < model.leadingLength) return 'leading';
  return withinRegion(node) === null ? 'content' : 'undecided';
}

/** The first perceivable node at or after an element in document order, or null. */
function firstPerceivableFrom(model: PageModel, element: MarloElement): MarloElement | null {
  const start = model.order.get(element);
  if (start === undefined) return null;
  // Binary search, because this runs once per heading, landmark and same-page link.
  let low = 0;
  let high = model.perceivable.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const node = model.perceivable[middle];
    if (node !== undefined && (model.order.get(node) ?? 0) < start) low = middle + 1;
    else high = middle;
  }
  return model.perceivable[low] ?? null;
}

/** The first perceivable node inside an element, or null when it has none. */
function firstPerceivableWithin(model: PageModel, element: MarloElement): MarloElement | null {
  const first = firstPerceivableFrom(model, element);
  return first !== null && contains(element, first) ? first : null;
}

function describe(element: MarloElement): string {
  const id = attr(element, 'id');
  return id === null || id === '' ? `<${element.tag}>` : `<${element.tag} id="${id}">`;
}

function excerpt(element: MarloElement): string {
  const text = normalise(element.text);
  if (text === '') return describe(element);
  return text.length <= 60 ? `"${text}"` : `"${text.slice(0, 59)}…"`;
}

/**
 * What follows the leading block: the first node of definite non-repeated content, and
 * whether any undecided content came before it or instead of it.
 */
function contentAfter(model: PageModel): {
  readonly definite: MarloElement | null;
  readonly undecided: boolean;
} {
  let undecided = false;
  for (const node of model.perceivable.slice(model.leadingLength)) {
    if (placementOf(model, node) === 'content') return { definite: node, undecided };
    undecided = true;
  }
  return { definite: null, undecided };
}

/** The verdict for a page whose opening is not a leading block Marlo recognises. */
function unrecognised(model: PageModel, check: string): RuleVerdict {
  if (!model.leadsElsewhere) {
    return {
      outcome: 'passed',
      message:
        'Nothing on this page, no link, form or script, leads to another page, so no block of it ' +
        'can repeat on a page it leads to, and there is nothing to bypass.',
    };
  }
  return {
    outcome: 'cantTell',
    message:
      'The page does not open with a block of links Marlo recognises as site navigation, so it ' +
      `cannot tell where the repeated content ends. Check by hand whether ${check}.`,
  };
}

/**
 * The verdicts every atomic rule shares once no candidate satisfied it: nothing after
 * the navigation, only undecided content after it, or content a custom element may hide.
 * When none of those applies, the first node of definite content, for the message.
 */
function beforeFailing(model: PageModel): RuleVerdict | MarloElement {
  const after = contentAfter(model);
  if (after.definite === null) {
    return after.undecided
      ? {
          outcome: 'cantTell',
          message:
            'Everything after the opening navigation sits in a nav, header, footer or aside, and ' +
            'whether that repeats across the site is not something one page shows.',
        }
      : {
          outcome: 'passed',
          message:
            'The page has nothing after its opening navigation, so there is nothing to skip to.',
        };
  }
  const custom = model.customElement;
  if (custom !== null) {
    return {
      outcome: 'cantTell',
      message:
        `The page uses <${custom.tag}>, and content in a custom element's shadow root is invisible ` +
        'to this check. It may hold exactly what the rule is looking for.',
    };
  }
  return after.definite;
}

function isVerdict(value: RuleVerdict | MarloElement): value is RuleVerdict {
  return 'outcome' in value;
}

/** Page-level rules apply once, to the root of an HTML document with a body. */
function page(document: MarloDocument): { element: MarloElement }[] {
  return document.root.tag === 'html' && findFirst(document, 'body') !== null
    ? [{ element: document.root }]
    : [];
}

const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  'banner',
  'complementary',
  'contentinfo',
  'form',
  'main',
  'navigation',
  'region',
  'search',
]);

function hasOwnName(element: MarloElement): boolean {
  return ['aria-label', 'aria-labelledby', 'title'].some(
    (name) => normalise(attr(element, name) ?? '') !== '',
  );
}

/** The landmark role of an element, or null. A `form` or `section` needs a name to be one. */
function landmarkRole(element: MarloElement): string | null {
  const role = explicitRole(element);
  if (role !== null) {
    if (!LANDMARK_ROLES.has(role)) return null;
    if ((role === 'region' || role === 'form') && !hasOwnName(element)) return null;
    return role;
  }
  switch (element.tag) {
    case 'main':
      return 'main';
    case 'search':
      return 'search';
    case 'section':
      return hasOwnName(element) ? 'region' : null;
    case 'form':
      return hasOwnName(element) ? 'form' : null;
    default:
      return regionOf(element);
  }
}

/** The verdict for b40fd1, shared with the composite. */
function landmarkVerdict(document: MarloDocument): RuleVerdict {
  const model = modelOf(document);
  const landmarks = [...walk(document.root)].filter(
    (element) => landmarkRole(element) !== null && !isHiddenFromAssistiveTech(element),
  );

  if (model.leadingLink === null) {
    const main = landmarks.find(
      (l) => landmarkRole(l) === 'main' && firstPerceivableWithin(model, l) !== null,
    );
    if (main !== undefined) {
      return {
        outcome: 'passed',
        message: `${describe(main)} is a main landmark, so a screen reader user can jump to the page's own content.`,
      };
    }
    return unrecognised(model, 'the page wraps its own content in a main landmark');
  }

  let undecided: MarloElement | null = null;
  for (const landmark of landmarks) {
    const first = firstPerceivableWithin(model, landmark);
    if (first === null) continue;
    const placement = placementOf(model, first);
    if (placement === 'content') {
      return {
        outcome: 'passed',
        message:
          `${describe(landmark)} is a ${landmarkRole(landmark) ?? 'landmark'} landmark starting after ` +
          `the navigation, so a screen reader user can jump straight to ${excerpt(first)}.`,
      };
    }
    if (placement === 'undecided') undecided ??= landmark;
  }

  const blocking = beforeFailing(model);
  if (isVerdict(blocking)) return blocking;
  if (undecided !== null) {
    return {
      outcome: 'cantTell',
      message:
        `${describe(undecided)} is a landmark starting after the opening navigation. If its ` +
        'content is unique to this page it satisfies the rule; if it is a site-wide sidebar or ' +
        'footer, the page content needs a main landmark of its own.',
    };
  }

  const hidden = [...walk(document.root)].find(
    (element) => landmarkRole(element) === 'main' && isHiddenFromAssistiveTech(element),
  );
  return {
    outcome: 'failed',
    message:
      hidden === undefined
        ? `The page opens with navigation, and its own content, starting at ${excerpt(blocking)}, ` +
          'is in no landmark. Wrap that content in a <main> element so a screen reader user can ' +
          'jump past the navigation in one keystroke.'
        : `${describe(hidden)} is hidden from assistive technology, so the content after the ` +
          'navigation is in no landmark a screen reader can reach. Remove aria-hidden or hidden ' +
          'from it.',
  };
}

/** b40fd1: the document has a landmark that starts with non-repeated content. */
export const landmarkWithNonRepeatedContent = defineRule({
  actId: 'b40fd1',
  name: 'Document has a landmark with non-repeated content',
  successCriteria: [],
  requires: ['dom'],
  // Which content is the page's own is a judgment about the page rather than the markup.
  fixability: 'never',
  applicability: page,
  expectation: (_target, document) => landmarkVerdict(document),
});

function isHeading(element: MarloElement): boolean {
  const role = explicitRole(element);
  return role === 'heading' || (role === null && /^h[1-6]$/.test(element.tag));
}

/** The verdict for 047fe0, shared with the composite. */
function headingVerdict(document: MarloDocument): RuleVerdict {
  const model = modelOf(document);
  const headings = [...walk(document.root)].filter(isHeading);
  const reachable = headings.filter(
    (h) =>
      !isHiddenFromAssistiveTech(h) &&
      !isVisuallyHidden(h) &&
      firstPerceivableWithin(model, h) !== null,
  );

  if (model.leadingLink === null) {
    const outside = reachable.find((heading) => withinRegion(heading) === null);
    if (outside !== undefined) {
      return {
        outcome: 'passed',
        message: `${excerpt(outside)} is a heading outside any navigation, header, footer or aside.`,
      };
    }
    return unrecognised(model, 'a heading starts the page content');
  }

  let undecided: MarloElement | null = null;
  for (const heading of reachable) {
    const first = firstPerceivableWithin(model, heading);
    if (first === null) continue;
    const placement = placementOf(model, first);
    if (placement === 'content') {
      return {
        outcome: 'passed',
        message: `${excerpt(heading)} is a heading after the navigation, so a reader moving by heading lands on the content.`,
      };
    }
    if (placement === 'undecided') undecided ??= heading;
  }

  const blocking = beforeFailing(model);
  if (isVerdict(blocking)) return blocking;
  if (undecided !== null) {
    return {
      outcome: 'cantTell',
      message:
        `The only heading after the navigation, ${excerpt(undecided)}, is inside a nav, header, ` +
        'footer or aside. If that block is unique to this page the rule passes; if it repeats, ' +
        'the page content needs a heading of its own.',
    };
  }

  // A heading the author wrote and then hid is the likeliest cause, and worth naming.
  const hidden = headings.find((h) => {
    if (reachable.includes(h)) return false;
    const first = firstPerceivableWithin(model, h);
    return first === null || placementOf(model, first) !== 'leading';
  });
  return {
    outcome: 'failed',
    message:
      hidden === undefined
        ? 'Nothing after the opening navigation is a heading, so a screen reader user moving by ' +
          `heading cannot land on the content that starts at ${excerpt(blocking)}. Mark the start ` +
          'of it with a heading element.'
        : `${excerpt(hidden)} looks like the heading for the page content, but it is hidden from ` +
          'assistive technology or from view, so nobody moving by heading reaches it.',
  };
}

/** 047fe0: the non-repeated content contains a heading. */
export const headingForNonRepeatedContent = defineRule({
  actId: '047fe0',
  name: 'Document has heading for non-repeated content',
  successCriteria: [],
  requires: ['dom'],
  // The words of a heading are content, and so is where a section starts.
  fixability: 'never',
  applicability: page,
  expectation: (_target, document) => headingVerdict(document),
});

/** The element a same-page fragment scrolls to, by id and then by a named anchor. */
function fragmentTarget(document: MarloDocument, fragment: string): MarloElement | null {
  const wanted = new Set([fragment]);
  try {
    wanted.add(decodeURIComponent(fragment));
  } catch {
    // A malformed escape is looked up as written.
  }
  for (const element of walk(document.root)) {
    const id = attr(element, 'id');
    if (id !== null && wanted.has(id)) return element;
  }
  for (const element of walk(document.root)) {
    if (element.tag === 'a' && wanted.has(attr(element, 'name') ?? '')) return element;
  }
  return null;
}

/**
 * Something that may move focus without being a plain link: an inline event handler, a
 * scripted or empty-fragment link, a button, or anything with a link or button role. A
 * script can make any of them a skip mechanism, and whether it does is not in the DOM.
 */
function scriptedInstrument(document: MarloDocument): MarloElement | null {
  const body = findFirst(document, 'body');
  if (body === null) return null;
  for (const element of walk(body)) {
    if (element === body || isVisuallyHidden(element)) continue;
    if (element.attributes.some((a) => a.name.startsWith('on'))) return element;
    const role = explicitRole(element);
    if (role === 'button' || (role === 'link' && element.tag !== 'a')) return element;
    if (element.tag === 'button') return element;
    if (element.tag === 'input' && (attr(element, 'type') ?? '').toLowerCase() === 'button') {
      return element;
    }
    const destination = linkDestination(element, document);
    if (destination?.kind === 'script') return element;
    if (destination?.kind === 'same-page' && destination.fragment === '') return element;
  }
  return null;
}

/** The verdict for ye5d6e, shared with the composite. */
function instrumentVerdict(document: MarloDocument): RuleVerdict {
  const model = modelOf(document);
  if (model.leadingLink === null) {
    return unrecognised(model, 'a link near the top moves focus past the navigation');
  }

  const body = findFirst(document, 'body');
  let undecided: string | null = null;
  let broken: string | null = null;
  for (const link of walk(document.root)) {
    const destination = linkDestination(link, document);
    if (destination?.kind !== 'same-page') continue;
    if (destination.fragment === null || destination.fragment === '') continue;
    const href = attr(link, 'href') ?? '';
    const target = fragmentTarget(document, destination.fragment);
    if (target === null) {
      broken ??= href;
      continue;
    }
    if (isVisuallyHidden(link)) {
      undecided ??= `href="${href}" is hidden, and a script may show it`;
      continue;
    }
    // Text belonging to an ancestor of the target has no position in this DOM view, so
    // it may sit between the target and whatever follows it.
    const ancestry = ancestors(target).filter((a) => a !== body && a !== document.root);
    if (ancestry.some(hasOwnText)) {
      undecided ??= `href="${href}" lands inside text Marlo cannot place`;
      continue;
    }
    const first = firstPerceivableFrom(model, target);
    if (first === null) continue;
    const placement = placementOf(model, first);
    if (placement === 'content') {
      return {
        outcome: 'passed',
        message: `The link href="${href}" moves focus to ${excerpt(first)}, past the navigation.`,
      };
    }
    if (placement === 'undecided') {
      undecided ??= `href="${href}" lands on ${excerpt(first)}, in a block that may or may not repeat`;
    }
  }

  const blocking = beforeFailing(model);
  if (isVerdict(blocking)) return blocking;
  if (undecided !== null) {
    return {
      outcome: 'cantTell',
      message: `A same-page link might skip the navigation: ${undecided}. Follow it and see where focus lands.`,
    };
  }
  const scripted = scriptedInstrument(document);
  if (scripted !== null) {
    return {
      outcome: 'cantTell',
      message:
        `No link skips the navigation, but ${describe(scripted)} could move focus by script, ` +
        'which the DOM does not show. Activate it and see where focus lands.',
    };
  }
  return {
    outcome: 'failed',
    message:
      broken === null
        ? 'Nothing on the page moves focus past the opening navigation. Add a "skip to content" ' +
          `link as the first focusable element, pointing at the content that starts at ${excerpt(blocking)}.`
        : `The link href="${broken}" points at an id that is not on this page, so activating it ` +
          'moves focus nowhere. Point it at the element where the content starts.',
  };
}

/** ye5d6e: an instrument moves focus to non-repeated content. */
export const instrumentToNonRepeatedContent = defineRule({
  actId: 'ye5d6e',
  name: 'Document has an instrument to move focus to non-repeated content',
  successCriteria: [],
  requires: ['dom'],
  // A skip link is markup, but where the page content starts is the author's call.
  fixability: 'never',
  applicability: page,
  expectation: (_target, document) => instrumentVerdict(document),
});

/**
 * Anything on the page that could collapse a block: script, an event handler, a form
 * control or label, a disclosure widget, ARIA disclosure state, or a same-page link on a
 * page with a stylesheet, which can hide a block on `:target`. When there is none,
 * 3e12e1 cannot pass on this page.
 */
function collapser(document: MarloDocument): MarloElement | null {
  const elements = [...walk(document.root)];
  const stylesheet = elements.some(
    (e) =>
      e.tag === 'style' ||
      (e.tag === 'link' && /(?:^|\s)stylesheet(?:\s|$)/i.test(attr(e, 'rel') ?? '')),
  );
  for (const element of elements) {
    if (COLLAPSING_TAGS.has(element.tag)) return element;
    if (element.attributes.some((a) => a.name.startsWith('on'))) return element;
    if (attr(element, 'aria-expanded') !== null || attr(element, 'aria-controls') !== null) {
      return element;
    }
    const role = explicitRole(element);
    if (role === 'button' || role === 'switch' || role === 'checkbox') return element;
    if (stylesheet && linkDestination(element, document)?.kind === 'same-page') return element;
  }
  return null;
}

const COLLAPSING_TAGS: ReadonlySet<string> = new Set([
  'script',
  'button',
  'details',
  'summary',
  'input',
  'select',
  'label',
]);

/**
 * cf77f2, a composite: the page passes when any of 047fe0, b40fd1, 3e12e1 or ye5d6e
 * passes, and fails when all four fail.
 *
 * Marlo does not implement 3e12e1, whether a block of repeated content is collapsible.
 * So this fails only on a page where 3e12e1 could not pass either, because nothing on it
 * could collapse anything. Wherever a collapse is possible, three failures are
 * `cantTell`: the fourth input may be the one that passes, and guessing that it does
 * not is the confident wrong finding this package exists to avoid.
 */
export const bypassBlocks = defineRule({
  actId: 'cf77f2',
  name: 'Bypass Blocks of Repeated Content',
  successCriteria: ['2.4.1'],
  requires: ['dom'],
  fixability: 'never',
  applicability: page,
  expectation: (_target, document) => {
    const inputs = [
      { id: 'b40fd1', verdict: landmarkVerdict(document) },
      { id: '047fe0', verdict: headingVerdict(document) },
      { id: 'ye5d6e', verdict: instrumentVerdict(document) },
    ];
    const passed = inputs.find((input) => input.verdict.outcome === 'passed');
    if (passed !== undefined) {
      return { outcome: 'passed', message: `${passed.verdict.message} (${passed.id})` };
    }
    if (modelOf(document).leadingLink === null) {
      return unrecognised(
        modelOf(document),
        'a main landmark, a heading or a skip link gets a reader past the navigation',
      );
    }
    const open = inputs.filter((input) => input.verdict.outcome !== 'failed');
    if (open.length > 0) {
      return {
        outcome: 'cantTell',
        message:
          'No way past the navigation was confirmed, and at least one was not ruled out. ' +
          open.map((input) => `${input.id}: ${input.verdict.message}`).join(' '),
      };
    }
    const control = collapser(document);
    if (control !== null) {
      return {
        outcome: 'cantTell',
        message:
          'The page has no landmark, heading or skip link past its navigation. That leaves a ' +
          `control that collapses the navigation, and ${describe(control)} could be one. Check ` +
          'whether it hides the navigation block.',
      };
    }
    return {
      outcome: 'failed',
      message:
        'A keyboard or screen reader user has to go through the whole navigation on every page: ' +
        'there is no main landmark, no heading after it, no skip link, and nothing that could ' +
        'collapse it. A <main> element around the page content is the smallest fix.',
    };
  },
});
