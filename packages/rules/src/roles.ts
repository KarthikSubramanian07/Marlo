import type { MarloElement } from './dom.js';
import { ancestors, attr, hasAttr, isInSequentialFocusOrder, normalise } from './dom.js';

/**
 * Roles: the explicit role an author wrote, the implicit role HTML gives an element, and
 * the semantic role ACT combines them into.
 *
 * The implicit roles come from HTML-AAM and ARIA in HTML, for the elements the rules
 * need. Where the two documents disagree, or the role depends on something the DOM does
 * not settle, the answer says so rather than picking one: `unknown` for an element this
 * table does not decide, and several candidate roles for an element whose role depends on
 * context Marlo does not resolve, such as a `th` that may be a column or a row header. A
 * rule that receives either answers `cantTell` unless every candidate gives the same
 * verdict.
 */

/** ARIA 1.2 non-abstract roles. Abstract roles are invalid as author values. */
export const ARIA_ROLES: ReadonlySet<string> = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'meter',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);

/** The first valid role token, which is how the role attribute is resolved. */
export function explicitRole(element: {
  attributes: readonly { name: string; value: string }[];
}): string | null {
  const raw = element.attributes.find((a) => a.name === 'role')?.value;
  if (raw === undefined) return null;
  for (const token of normalise(raw).split(' ')) {
    if (token !== '' && ARIA_ROLES.has(token.toLowerCase())) return token.toLowerCase();
  }
  return null;
}

/** WAI-ARIA 1.2 section 6.5: the global states and properties, deprecated ones included. */
export const GLOBAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'aria-atomic',
  'aria-busy',
  'aria-controls',
  'aria-current',
  'aria-describedby',
  'aria-details',
  'aria-disabled',
  'aria-dropeffect',
  'aria-errormessage',
  'aria-flowto',
  'aria-grabbed',
  'aria-haspopup',
  'aria-hidden',
  'aria-invalid',
  'aria-keyshortcuts',
  'aria-label',
  'aria-labelledby',
  'aria-live',
  'aria-owns',
  'aria-relevant',
  'aria-roledescription',
]);

/**
 * ACT's "focusable": part of sequential focus navigation, or carrying a tabindex that
 * parses as an integer, negative ones included, since `tabindex="-1"` makes an element
 * focusable by script and by pointer even though Tab skips it.
 */
export function canReceiveFocus(element: MarloElement): boolean {
  const tabindex = attr(element, 'tabindex');
  if (tabindex !== null && !Number.isNaN(Number.parseInt(tabindex.trim(), 10))) return true;
  return isInSequentialFocusOrder(element);
}

/** What the host language gives an element, before or instead of an explicit role. */
export type RoleAnswer =
  /** One role, or the roles it may have when context the DOM cannot settle decides. */
  | { readonly kind: 'role'; readonly roles: readonly string[] }
  /** "No corresponding role" in ARIA in HTML: exposed, if at all, with no role of its own. */
  | { readonly kind: 'no-role' }
  /** Not decided here. A rule that needs it answers `cantTell`. */
  | { readonly kind: 'unknown' };

const role = (...roles: string[]): RoleAnswer => ({ kind: 'role', roles });
const NO_ROLE: RoleAnswer = { kind: 'no-role' };
const UNKNOWN: RoleAnswer = { kind: 'unknown' };

/** Elements HTML-AAM maps to one role whatever their context. */
const FIXED: Readonly<Record<string, string>> = Object.freeze({
  address: 'group',
  article: 'article',
  aside: 'complementary',
  b: 'generic',
  bdi: 'generic',
  bdo: 'generic',
  blockquote: 'blockquote',
  body: 'generic',
  button: 'button',
  caption: 'caption',
  code: 'code',
  data: 'generic',
  datalist: 'listbox',
  del: 'deletion',
  details: 'group',
  dfn: 'term',
  dialog: 'dialog',
  div: 'generic',
  em: 'emphasis',
  fieldset: 'group',
  figure: 'figure',
  form: 'form',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  hgroup: 'group',
  hr: 'separator',
  i: 'generic',
  ins: 'insertion',
  main: 'main',
  math: 'math',
  menu: 'list',
  meter: 'meter',
  nav: 'navigation',
  ol: 'list',
  optgroup: 'group',
  option: 'option',
  output: 'status',
  p: 'paragraph',
  pre: 'generic',
  progress: 'progressbar',
  q: 'generic',
  s: 'deletion',
  samp: 'generic',
  search: 'search',
  small: 'generic',
  span: 'generic',
  strong: 'strong',
  sub: 'subscript',
  sup: 'superscript',
  svg: 'graphics-document',
  textarea: 'textbox',
  time: 'time',
  u: 'generic',
  ul: 'list',
});

/** Elements ARIA in HTML lists with "No corresponding role". */
const NO_CORRESPONDING_ROLE: ReadonlySet<string> = new Set([
  'abbr',
  'audio',
  'br',
  'canvas',
  'cite',
  'embed',
  'figcaption',
  'iframe',
  'kbd',
  'label',
  'legend',
  'mark',
  'object',
  'picture',
  'rp',
  'rt',
  'ruby',
  'var',
  'video',
  'wbr',
]);

/** Input types ARIA in HTML lists with "No corresponding role". */
const ROLELESS_INPUTS: ReadonlySet<string> = new Set([
  'color',
  'date',
  'datetime-local',
  'file',
  'month',
  'password',
  'time',
  'week',
]);

function inputRole(element: MarloElement): RoleAnswer {
  const type = normalise(attr(element, 'type') ?? '').toLowerCase();
  const list = hasAttr(element, 'list');
  switch (type) {
    case 'button':
    case 'image':
    case 'reset':
    case 'submit':
      return role('button');
    case 'checkbox':
      return role('checkbox');
    case 'radio':
      return role('radio');
    case 'range':
      return role('slider');
    case 'number':
      return role('spinbutton');
    case 'search':
      return role(list ? 'combobox' : 'searchbox');
    case 'hidden':
      return UNKNOWN;
    default:
      if (ROLELESS_INPUTS.has(type)) return NO_ROLE;
      // text, email, tel, url, and any type HTML does not define, which is the Text state.
      return role(list ? 'combobox' : 'textbox');
  }
}

/** Whether a header or footer is scoped to a section, which makes it generic. */
function scopedToSection(element: MarloElement): boolean {
  return ancestors(element).some((a) => {
    if (['article', 'aside', 'main', 'nav', 'section'].includes(a.tag)) return true;
    const explicit = explicitRole(a);
    return (
      explicit !== null &&
      ['article', 'complementary', 'main', 'navigation', 'region'].includes(explicit)
    );
  });
}

function hasAuthorName(element: MarloElement): boolean {
  return ['aria-label', 'aria-labelledby', 'title'].some(
    (name) => normalise(attr(element, name) ?? '') !== '',
  );
}

/** Whether the presentational conflict resolution of ARIA 1.2 overrides none/presentation. */
function presentationOverridden(element: MarloElement): boolean {
  return canReceiveFocus(element) || element.attributes.some((a) => GLOBAL_ATTRIBUTES.has(a.name));
}

/**
 * The role a table part takes from the nearest `table` around it: table parts of a
 * table exposed as a table, grid or treegrid, presentational with a presentational table,
 * and undecided under any other role, where ARIA in HTML gives them no role.
 */
function tableContext(element: MarloElement): 'table' | 'grid' | 'none' | 'other' {
  const table = ancestors(element).find((a) => a.tag === 'table');
  if (table === undefined) return 'other';
  const answer = semanticRoles(table);
  if (answer.kind !== 'role') return 'other';
  const [only] = answer.roles;
  if (answer.roles.length !== 1 || only === undefined) return 'other';
  if (only === 'table') return 'table';
  if (only === 'grid' || only === 'treegrid') return 'grid';
  if (only === 'none' || only === 'presentation') return 'none';
  return 'other';
}

/** The implicit role of an element, from HTML-AAM and ARIA in HTML. */
export function implicitRoles(element: MarloElement): RoleAnswer {
  const fixed = FIXED[element.tag];
  if (fixed !== undefined) return role(fixed);
  if (NO_CORRESPONDING_ROLE.has(element.tag)) return NO_ROLE;
  switch (element.tag) {
    case 'a':
    case 'area':
      return hasAttr(element, 'href') ? role('link') : role('generic');
    case 'img': {
      // alt="" marks the image decorative, unless it is named another way, and unless
      // the conflict resolution below puts it back in the tree.
      const decorative = attr(element, 'alt') === '' && !hasAuthorName(element);
      if (decorative && !presentationOverridden(element)) return role('none');
      return role('img');
    }
    case 'input':
      return inputRole(element);
    case 'select': {
      const size = Number.parseInt(attr(element, 'size') ?? '', 10);
      return hasAttr(element, 'multiple') || (!Number.isNaN(size) && size > 1)
        ? role('listbox')
        : role('combobox');
    }
    case 'li': {
      const parent = element.parent;
      if (parent === null) return role('generic');
      const answer = semanticRoles(parent);
      return answer.kind === 'role' && answer.roles.length === 1 && answer.roles[0] === 'list'
        ? role('listitem')
        : role('generic');
    }
    case 'header':
      return role(scopedToSection(element) ? 'generic' : 'banner');
    case 'footer':
      return role(scopedToSection(element) ? 'generic' : 'contentinfo');
    case 'section':
      return role(hasAuthorName(element) ? 'region' : 'generic');
    case 'table':
      return role('table');
    case 'tbody':
    case 'thead':
    case 'tfoot':
    case 'tr':
    case 'td':
    case 'th': {
      const context = tableContext(element);
      if (context === 'other') return UNKNOWN;
      if (context === 'none') return role('none');
      if (element.tag === 'tr') return role('row');
      if (element.tag === 'td') return role(context === 'grid' ? 'gridcell' : 'cell');
      if (element.tag === 'th') {
        return role('columnheader', 'rowheader', context === 'grid' ? 'gridcell' : 'cell');
      }
      return role('rowgroup');
    }
    default:
      return UNKNOWN;
  }
}

/**
 * ACT's semantic role: the explicit role, unless it is `none` or `presentation` on an
 * element that is focusable or carries a global ARIA attribute, where ARIA 1.2's conflict
 * resolution restores the implicit role; otherwise the implicit role.
 */
export function semanticRoles(element: MarloElement): RoleAnswer {
  const explicit = explicitRole(element);
  if (explicit === null) return implicitRoles(element);
  if ((explicit === 'none' || explicit === 'presentation') && presentationOverridden(element)) {
    return implicitRoles(element);
  }
  return role(explicit);
}
