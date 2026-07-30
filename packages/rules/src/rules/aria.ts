import { defineRule } from '../define.js';
import { attr, findAll, isFocusable, isHiddenFromAssistiveTech, normalise, walk } from '../dom.js';

/**
 * The ARIA validity rules. Decidable from the DOM, mechanically fixable, and the
 * category where a wrong attribute does active harm rather than merely omitting
 * information: `aria-checked="yes"` makes a checkbox announce nothing useful, and
 * removing it is strictly better than leaving it.
 *
 * The ARIA 1.2 vocabulary below is transcribed rather than fetched. It is a
 * specification with a stable published version, not a living corpus, so a copy with a
 * date on it is honest in a way the ACT corpus would not be.
 */

/** ARIA 1.2 states and properties, with the value type each takes. */
type AriaValueType =
  | 'true-false'
  | 'true-false-undefined'
  | 'tristate'
  | 'id-reference'
  | 'id-reference-list'
  | 'integer'
  | 'number'
  | 'string'
  | 'token'
  | 'token-list';

interface AriaAttributeSpec {
  readonly type: AriaValueType;
  readonly tokens?: readonly string[];
}

/** Transcribed from WAI-ARIA 1.2, section 6.6. */
export const ARIA_ATTRIBUTES: Readonly<Record<string, AriaAttributeSpec>> = Object.freeze({
  'aria-activedescendant': { type: 'id-reference' },
  'aria-atomic': { type: 'true-false' },
  'aria-autocomplete': { type: 'token', tokens: ['inline', 'list', 'both', 'none'] },
  'aria-braillelabel': { type: 'string' },
  'aria-brailleroledescription': { type: 'string' },
  'aria-busy': { type: 'true-false' },
  'aria-checked': { type: 'tristate' },
  'aria-colcount': { type: 'integer' },
  'aria-colindex': { type: 'integer' },
  'aria-colspan': { type: 'integer' },
  'aria-controls': { type: 'id-reference-list' },
  'aria-current': {
    type: 'token',
    tokens: ['page', 'step', 'location', 'date', 'time', 'true', 'false'],
  },
  'aria-describedby': { type: 'id-reference-list' },
  'aria-description': { type: 'string' },
  'aria-details': { type: 'id-reference' },
  'aria-disabled': { type: 'true-false' },
  'aria-dropeffect': {
    type: 'token-list',
    tokens: ['copy', 'execute', 'link', 'move', 'none', 'popup'],
  },
  'aria-errormessage': { type: 'id-reference' },
  'aria-expanded': { type: 'true-false-undefined' },
  'aria-flowto': { type: 'id-reference-list' },
  'aria-grabbed': { type: 'true-false-undefined' },
  'aria-haspopup': {
    type: 'token',
    tokens: ['false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog'],
  },
  'aria-hidden': { type: 'true-false-undefined' },
  'aria-invalid': { type: 'token', tokens: ['grammar', 'false', 'spelling', 'true'] },
  'aria-keyshortcuts': { type: 'string' },
  'aria-label': { type: 'string' },
  'aria-labelledby': { type: 'id-reference-list' },
  'aria-level': { type: 'integer' },
  'aria-live': { type: 'token', tokens: ['assertive', 'off', 'polite'] },
  'aria-modal': { type: 'true-false' },
  'aria-multiline': { type: 'true-false' },
  'aria-multiselectable': { type: 'true-false' },
  'aria-orientation': { type: 'token', tokens: ['horizontal', 'undefined', 'vertical'] },
  'aria-owns': { type: 'id-reference-list' },
  'aria-placeholder': { type: 'string' },
  'aria-posinset': { type: 'integer' },
  'aria-pressed': { type: 'tristate' },
  'aria-readonly': { type: 'true-false' },
  'aria-relevant': {
    type: 'token-list',
    tokens: ['additions', 'all', 'removals', 'text'],
  },
  'aria-required': { type: 'true-false' },
  'aria-roledescription': { type: 'string' },
  'aria-rowcount': { type: 'integer' },
  'aria-rowindex': { type: 'integer' },
  'aria-rowspan': { type: 'integer' },
  'aria-selected': { type: 'true-false-undefined' },
  'aria-setsize': { type: 'integer' },
  'aria-sort': { type: 'token', tokens: ['ascending', 'descending', 'none', 'other'] },
  'aria-valuemax': { type: 'number' },
  'aria-valuemin': { type: 'number' },
  'aria-valuenow': { type: 'number' },
  'aria-valuetext': { type: 'string' },
});

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

/** Roles that prohibit a naming attribute, from ARIA 1.2's prohibited-attributes table. */
const NAME_PROHIBITED_ROLES: ReadonlySet<string> = new Set([
  'caption',
  'code',
  'deletion',
  'emphasis',
  'generic',
  'insertion',
  'paragraph',
  'presentation',
  'none',
  'strong',
  'subscript',
  'superscript',
  'term',
  'time',
]);

/** Roles whose required owned elements the ACT rule checks. */
const REQUIRED_OWNED: Readonly<Record<string, readonly string[]>> = Object.freeze({
  feed: ['article'],
  grid: ['row', 'rowgroup'],
  list: ['listitem'],
  listbox: ['option', 'group'],
  menu: ['menuitem', 'menuitemcheckbox', 'menuitemradio', 'group'],
  menubar: ['menuitem', 'menuitemcheckbox', 'menuitemradio', 'group'],
  radiogroup: ['radio'],
  row: ['cell', 'columnheader', 'gridcell', 'rowheader'],
  rowgroup: ['row'],
  table: ['row', 'rowgroup'],
  tablist: ['tab'],
  tree: ['treeitem', 'group'],
  treegrid: ['row', 'rowgroup'],
});

/** Roles that require a particular context role, from ARIA 1.2. */
const REQUIRED_CONTEXT: Readonly<Record<string, readonly string[]>> = Object.freeze({
  caption: ['figure', 'grid', 'table', 'treegrid'],
  cell: ['row'],
  columnheader: ['row'],
  gridcell: ['row'],
  listitem: ['list'],
  menuitem: ['group', 'menu', 'menubar'],
  menuitemcheckbox: ['group', 'menu', 'menubar'],
  menuitemradio: ['group', 'menu', 'menubar'],
  option: ['group', 'listbox'],
  row: ['grid', 'rowgroup', 'table', 'treegrid'],
  rowgroup: ['grid', 'table', 'treegrid'],
  rowheader: ['row'],
  tab: ['tablist'],
  treeitem: ['group', 'tree'],
});

/** Required states and properties per role, from ARIA 1.2. */
const REQUIRED_PROPERTIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  checkbox: ['aria-checked'],
  combobox: ['aria-expanded'],
  heading: ['aria-level'],
  menuitemcheckbox: ['aria-checked'],
  menuitemradio: ['aria-checked'],
  option: ['aria-selected'],
  radio: ['aria-checked'],
  scrollbar: ['aria-controls', 'aria-valuenow'],
  separator: ['aria-valuenow'],
  slider: ['aria-valuenow'],
  switch: ['aria-checked'],
});

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

function ariaAttributesOf(element: { attributes: readonly { name: string; value: string }[] }) {
  return element.attributes.filter((a) => a.name.startsWith('aria-'));
}

/** 5f99a7: every aria- attribute is defined in WAI-ARIA. */
export const ariaAttributeDefined = defineRule({
  actId: '5f99a7',
  name: 'ARIA attribute is defined in WAI-ARIA',
  successCriteria: ['1.3.1', '4.1.2'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      if (ariaAttributesOf(element).length > 0) targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    const undefinedAttrs = ariaAttributesOf(element)
      .map((a) => a.name)
      .filter((name) => !Object.hasOwn(ARIA_ATTRIBUTES, name));
    if (undefinedAttrs.length === 0) {
      return { outcome: 'passed', message: 'Every aria- attribute is defined in ARIA 1.2.' };
    }
    return {
      outcome: 'failed',
      message:
        `${undefinedAttrs.join(', ')} ${undefinedAttrs.length === 1 ? 'is' : 'are'} not defined ` +
        'in ARIA 1.2, so assistive technology ignores it. Usually a typo.',
    };
  },
});

/** 674b10: the role attribute has a valid value. */
export const roleValueValid = defineRule({
  actId: '674b10',
  name: 'Role attribute has valid value',
  successCriteria: ['1.3.1', '4.1.2'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      const role = attr(element, 'role');
      if (role !== null && normalise(role) !== '') targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    const raw = normalise(attr(element, 'role') ?? '');
    const tokens = raw.split(' ').filter((t) => t !== '');
    // A role list is valid if any token is valid: the browser takes the first valid one.
    const valid = tokens.filter((t) => ARIA_ROLES.has(t.toLowerCase()));
    if (valid.length > 0) {
      return { outcome: 'passed', message: `role="${valid[0] ?? ''}" is a valid ARIA role.` };
    }
    return {
      outcome: 'failed',
      message:
        `role="${raw}" contains no valid ARIA role, so the element keeps its native semantics ` +
        "and the author's intent is lost silently.",
    };
  },
});

/** 6a7281: an ARIA state or property has a valid value. */
export const ariaValueValid = defineRule({
  actId: '6a7281',
  name: 'ARIA state or property has valid value',
  successCriteria: ['1.3.1', '4.1.2'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      const defined = ariaAttributesOf(element).filter((a) =>
        Object.hasOwn(ARIA_ATTRIBUTES, a.name),
      );
      if (defined.length > 0) targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    const problems: string[] = [];
    let uncertain = false;

    for (const attribute of ariaAttributesOf(element)) {
      const spec = ARIA_ATTRIBUTES[attribute.name];
      if (spec === undefined) continue; // 5f99a7's business.
      const value = normalise(attribute.value);

      switch (spec.type) {
        case 'true-false':
          if (!['true', 'false'].includes(value.toLowerCase())) {
            problems.push(`${attribute.name}="${value}" must be true or false`);
          }
          break;
        case 'true-false-undefined':
          if (!['true', 'false', 'undefined', ''].includes(value.toLowerCase())) {
            problems.push(`${attribute.name}="${value}" must be true, false or undefined`);
          }
          break;
        case 'tristate':
          if (!['true', 'false', 'mixed', 'undefined', ''].includes(value.toLowerCase())) {
            problems.push(`${attribute.name}="${value}" must be true, false or mixed`);
          }
          break;
        case 'integer':
          if (!/^-?\d+$/.test(value)) {
            problems.push(`${attribute.name}="${value}" must be an integer`);
          }
          break;
        case 'number':
          if (!/^-?\d+(?:\.\d+)?$/.test(value)) {
            problems.push(`${attribute.name}="${value}" must be a number`);
          }
          break;
        case 'token':
          if (spec.tokens !== undefined && !spec.tokens.includes(value.toLowerCase())) {
            problems.push(`${attribute.name}="${value}" must be one of ${spec.tokens.join(', ')}`);
          }
          break;
        case 'token-list':
          if (spec.tokens !== undefined) {
            const bad = value
              .split(' ')
              .filter((t) => t !== '')
              .filter((t) => !spec.tokens?.includes(t.toLowerCase()));
            if (bad.length > 0) {
              problems.push(
                `${attribute.name} contains ${bad.join(', ')}, which ${bad.length === 1 ? 'is' : 'are'} not permitted`,
              );
            }
          }
          break;
        case 'id-reference':
        case 'id-reference-list': {
          if (value === '') break;
          const ids = value.split(' ').filter((t) => t !== '');
          const present = new Set<string>();
          for (const node of walk(document.root)) {
            const id = attr(node, 'id');
            if (id !== null) present.add(id);
          }
          const dangling = ids.filter((id) => !present.has(id));
          if (dangling.length === ids.length && ids.length > 0) {
            problems.push(
              `${attribute.name} references ${dangling.join(', ')}, which ${dangling.length === 1 ? 'does' : 'do'} not exist`,
            );
          } else if (dangling.length > 0) {
            // Some resolve and some do not. The ACT rule treats a partially resolving
            // list as valid, so this is not a failure, but it is worth not asserting a
            // clean pass either.
            uncertain = true;
          }
          break;
        }
        case 'string':
          // Any string is valid, including an empty one.
          break;
      }
    }

    if (problems.length > 0) {
      return {
        outcome: 'failed',
        message: `${problems.join('; ')}. An invalid value is ignored, so the state is not conveyed.`,
      };
    }
    if (uncertain) {
      return {
        outcome: 'cantTell',
        message:
          'Some ids in an ARIA reference list do not resolve. The specification permits a ' +
          'partially resolving list, so this is not a failure, but it is probably not intended.',
      };
    }
    return { outcome: 'passed', message: 'Every ARIA value is valid for its attribute type.' };
  },
});

/** 5c01ea: an ARIA state or property is permitted on the element. */
export const ariaPropertyPermitted = defineRule({
  actId: '5c01ea',
  name: 'ARIA state or property is permitted',
  successCriteria: ['1.3.1', '4.1.2'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      if (ariaAttributesOf(element).some((a) => Object.hasOwn(ARIA_ATTRIBUTES, a.name))) {
        targets.push({ element });
      }
    }
    return targets;
  },
  expectation: ({ element }) => {
    const role = explicitRole(element);
    if (role === null) {
      // Without an explicit role, deciding what is permitted needs the implicit role,
      // which depends on the full HTML-AAM mapping including context. Marlo declines
      // rather than guessing.
      return {
        outcome: 'cantTell',
        message:
          'The element has no explicit role, so deciding which ARIA properties are permitted ' +
          'needs its implicit role, which Marlo does not compute for every element.',
      };
    }

    if (!NAME_PROHIBITED_ROLES.has(role)) {
      return { outcome: 'passed', message: `Properties are permitted on role="${role}".` };
    }

    const prohibited = ariaAttributesOf(element)
      .map((a) => a.name)
      .filter((name) => name === 'aria-label' || name === 'aria-labelledby');

    if (prohibited.length === 0) {
      return { outcome: 'passed', message: `No prohibited property on role="${role}".` };
    }
    return {
      outcome: 'failed',
      message:
        `role="${role}" prohibits ${prohibited.join(' and ')}. ARIA 1.2 forbids naming this role, ` +
        'so the name is ignored and the author believes it was applied.',
    };
  },
});

/** 4e8ab6: an element with a role has that role's required states and properties. */
export const roleRequiredProperties = defineRule({
  actId: '4e8ab6',
  name: 'Element with role attribute has required states and properties',
  successCriteria: ['1.3.1', '4.1.2'],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      const role = explicitRole(element);
      if (role !== null && Object.hasOwn(REQUIRED_PROPERTIES, role)) {
        if (!isHiddenFromAssistiveTech(element)) targets.push({ element });
      }
    }
    return targets;
  },
  expectation: ({ element }) => {
    const role = explicitRole(element) ?? '';
    const required = REQUIRED_PROPERTIES[role] ?? [];
    const missing = required.filter((name) => attr(element, name) === null);
    if (missing.length === 0) {
      return { outcome: 'passed', message: `role="${role}" has its required properties.` };
    }
    return {
      outcome: 'failed',
      message:
        `role="${role}" requires ${missing.join(', ')}. Without ${missing.length === 1 ? 'it' : 'them'} ` +
        'the widget announces its role but not its state.',
    };
  },
});

/** ff89c9: a role requiring a context role has one. */
export const requiredContextRole = defineRule({
  actId: 'ff89c9',
  name: 'ARIA required context role',
  successCriteria: ['1.3.1'],
  requires: ['dom'],
  fixability: 'never',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      const role = explicitRole(element);
      if (role !== null && Object.hasOwn(REQUIRED_CONTEXT, role)) {
        if (!isHiddenFromAssistiveTech(element)) targets.push({ element });
      }
    }
    return targets;
  },
  expectation: ({ element }) => {
    const role = explicitRole(element) ?? '';
    const permitted = REQUIRED_CONTEXT[role] ?? [];
    let current = element.parent;
    while (current !== null) {
      const parentRole = explicitRole(current);
      if (parentRole !== null) {
        if (permitted.includes(parentRole)) {
          return { outcome: 'passed', message: `role="${role}" is inside role="${parentRole}".` };
        }
        // A generic wrapper is transparent; any other explicit role is not.
        if (parentRole !== 'generic' && parentRole !== 'none' && parentRole !== 'presentation') {
          return {
            outcome: 'failed',
            message:
              `role="${role}" must be contained in ${permitted.join(' or ')}, but its nearest ` +
              `role is "${parentRole}".`,
          };
        }
      }
      current = current.parent;
    }
    return {
      outcome: 'cantTell',
      message:
        `role="${role}" requires a context of ${permitted.join(' or ')}. No ancestor declares an ` +
        'explicit role, so the context would come from implicit roles, which Marlo does not ' +
        'compute for every element.',
    };
  },
});

/** bc4a75: a role requiring owned elements has them. */
export const requiredOwnedElements = defineRule({
  actId: 'bc4a75',
  name: 'ARIA required owned elements',
  successCriteria: ['1.3.1'],
  requires: ['dom'],
  fixability: 'never',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      const role = explicitRole(element);
      if (role !== null && Object.hasOwn(REQUIRED_OWNED, role)) {
        if (!isHiddenFromAssistiveTech(element)) targets.push({ element });
      }
    }
    return targets;
  },
  expectation: ({ element }) => {
    const role = explicitRole(element) ?? '';
    const permitted = REQUIRED_OWNED[role] ?? [];

    // aria-owns can bring in elements from elsewhere in the document, and resolving it
    // properly means rebuilding the accessibility tree. Declining is the honest answer.
    if (attr(element, 'aria-owns') !== null) {
      return {
        outcome: 'cantTell',
        message:
          `role="${role}" uses aria-owns, so its owned elements come from elsewhere in the ` +
          'document. Marlo does not rebuild the accessibility tree to resolve that.',
      };
    }

    const children = element.children.filter((c) => !isHiddenFromAssistiveTech(c));
    if (children.length === 0) {
      return {
        outcome: 'failed',
        message:
          `role="${role}" requires at least one ${permitted.join(' or ')} and has no exposed ` +
          'children at all.',
      };
    }

    const anyExplicit = children.some((c) => explicitRole(c) !== null);
    if (!anyExplicit) {
      return {
        outcome: 'cantTell',
        message:
          `role="${role}" requires ${permitted.join(' or ')}. None of its children declare an ` +
          'explicit role, so the answer depends on implicit roles Marlo does not compute here.',
      };
    }

    const satisfied = children.some((c) => {
      const childRole = explicitRole(c);
      return childRole !== null && permitted.includes(childRole);
    });
    if (satisfied) {
      return { outcome: 'passed', message: `role="${role}" owns a permitted child role.` };
    }
    return {
      outcome: 'failed',
      message:
        `role="${role}" requires ${permitted.join(' or ')} children, and none of its children ` +
        'have one of those roles.',
    };
  },
});

/** 6cfa84: an aria-hidden element contains nothing in the focus order. */
export const ariaHiddenNoFocusable = defineRule({
  actId: '6cfa84',
  name: 'Element with aria-hidden has no content in sequential focus navigation',
  successCriteria: ['4.1.2'],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, [
      'div',
      'span',
      'a',
      'button',
      'input',
      'select',
      'textarea',
      'p',
      'section',
      'nav',
      'ul',
      'ol',
      'li',
      'form',
      'header',
      'footer',
      'main',
      'aside',
      'article',
      'table',
      'td',
      'th',
      'label',
      'summary',
      'details',
      'iframe',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'img',
      'svg',
    ])) {
      if (attr(element, 'aria-hidden') === 'true') targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    const focusable = [...walk(element)].filter((node) => isFocusable(node));
    if (focusable.length === 0) {
      return { outcome: 'passed', message: 'Nothing inside the hidden element is focusable.' };
    }
    const names = focusable.map((f) => f.tag).join(', ');
    return {
      outcome: 'failed',
      message:
        `aria-hidden="true" hides this from assistive technology, but it still contains ` +
        `${String(focusable.length)} focusable element${focusable.length === 1 ? '' : 's'} ` +
        `(${names}). A keyboard user reaches something a screen reader cannot describe.`,
    };
  },
});
