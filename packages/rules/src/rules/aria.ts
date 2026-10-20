import { defineRule } from '../define.js';
import type { MarloElement } from '../dom.js';
import {
  ancestors,
  attr,
  findAll,
  isHiddenFromAssistiveTech,
  isInSequentialFocusOrder,
  isNotRendered,
  normalise,
  walk,
} from '../dom.js';
import type { RoleAnswer } from '../roles.js';
import {
  ARIA_ROLES,
  GLOBAL_ATTRIBUTES,
  canReceiveFocus,
  explicitRole,
  languageFeaturePermits,
  rolePermits,
  semanticRoles,
} from '../roles.js';

export { ARIA_ROLES, explicitRole };

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

/**
 * Transcribed from WAI-ARIA 1.2, section 6.7: its 48 states and properties and no others.
 * The Graphics and DPUB modules define none of their own. `aria-description`,
 * `aria-braillelabel` and `aria-brailleroledescription` exist only in the ARIA 1.3 draft,
 * and the ACT rules pin 1.2, so they are not here however widely browsers support them.
 */
export const ARIA_ATTRIBUTES: Readonly<Record<string, AriaAttributeSpec>> = Object.freeze({
  'aria-activedescendant': { type: 'id-reference' },
  'aria-atomic': { type: 'true-false' },
  'aria-autocomplete': { type: 'token', tokens: ['inline', 'list', 'both', 'none'] },
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

/**
 * The non-abstract roles of the two ARIA modules ACT counts among the WAI-ARIA
 * Specifications: Digital Publishing WAI-ARIA Module 1.0, all 39 of its roles, and the
 * WAI-ARIA Graphics Module 1.0. Transcribed from the published modules. 674b10 accepts
 * them as valid role values. `explicitRole` does not resolve them, because every table it
 * feeds is an ARIA 1.2 table: a module role reads as no explicit role there, which leaves
 * the element its implicit role, the superclass of most of these.
 */
export const MODULE_ROLES: ReadonlySet<string> = new Set([
  'doc-abstract',
  'doc-acknowledgments',
  'doc-afterword',
  'doc-appendix',
  'doc-backlink',
  'doc-biblioentry',
  'doc-bibliography',
  'doc-biblioref',
  'doc-chapter',
  'doc-colophon',
  'doc-conclusion',
  'doc-cover',
  'doc-credit',
  'doc-credits',
  'doc-dedication',
  'doc-endnote',
  'doc-endnotes',
  'doc-epigraph',
  'doc-epilogue',
  'doc-errata',
  'doc-example',
  'doc-footnote',
  'doc-foreword',
  'doc-glossary',
  'doc-glossref',
  'doc-index',
  'doc-introduction',
  'doc-noteref',
  'doc-notice',
  'doc-pagebreak',
  'doc-pagelist',
  'doc-part',
  'doc-preface',
  'doc-prologue',
  'doc-pullquote',
  'doc-qna',
  'doc-subtitle',
  'doc-tip',
  'doc-toc',
  'graphics-document',
  'graphics-object',
  'graphics-symbol',
]);

/**
 * WAI-ARIA 1.2's required owned elements, the version bc4a75 names. `direct` roles may be
 * owned as they are. A `through` role may be owned only if it in turn owns nothing but
 * the roles listed for it, which is what ARIA writes with an arrow: `group → menuitem`.
 * ACT adds that a `group` may own another `group` that meets the same requirement.
 *
 * Copied from the 1.2 Recommendation rather than a later draft, so `caption`, which ARIA
 * 1.3 adds for `table` and `grid`, is not here.
 */
interface OwnedRequirement {
  readonly direct: readonly string[];
  readonly through?: Readonly<Record<string, readonly string[]>>;
}

const MENU_ITEMS = ['menuitem', 'menuitemcheckbox', 'menuitemradio'];

const REQUIRED_OWNED: Readonly<Record<string, OwnedRequirement>> = Object.freeze({
  feed: { direct: ['article'] },
  grid: { direct: ['row'], through: { rowgroup: ['row'] } },
  list: { direct: ['listitem'] },
  listbox: { direct: ['option'], through: { group: ['option'] } },
  menu: { direct: MENU_ITEMS, through: { group: MENU_ITEMS } },
  menubar: { direct: MENU_ITEMS, through: { group: MENU_ITEMS } },
  radiogroup: { direct: ['radio'] },
  row: { direct: ['cell', 'columnheader', 'gridcell', 'rowheader'] },
  rowgroup: { direct: ['row'] },
  table: { direct: ['row'], through: { rowgroup: ['row'] } },
  tablist: { direct: ['tab'] },
  tree: { direct: ['treeitem'], through: { group: ['treeitem'] } },
  treegrid: { direct: ['row'], through: { rowgroup: ['row'] } },
});

/** Elements that never appear in the accessibility tree, whatever their styles. */
const NEVER_EXPOSED: ReadonlySet<string> = new Set([
  'base',
  'col',
  'colgroup',
  'datalist',
  'head',
  'link',
  'meta',
  'noscript',
  'param',
  'script',
  'source',
  'style',
  'template',
  'title',
  'track',
]);

function notExposed(element: MarloElement): boolean {
  return (
    NEVER_EXPOSED.has(element.tag) || isHiddenFromAssistiveTech(element) || isNotRendered(element)
  );
}

/** The single role of an answer, or null when it has none or several. */
function soleRole(answer: RoleAnswer): string | null {
  return answer.kind === 'role' && answer.roles.length === 1 ? (answer.roles[0] ?? null) : null;
}

/**
 * The aria-owns relationships of a document: for each id, the elements that claim it, and
 * the element that carries it. Built once per document.
 */
interface Ownership {
  readonly claims: ReadonlyMap<string, readonly MarloElement[]>;
  readonly byId: ReadonlyMap<string, MarloElement>;
}

const OWNERSHIP = new WeakMap<MarloElement, Ownership>();

function ownershipOf(root: MarloElement): Ownership {
  const cached = OWNERSHIP.get(root);
  if (cached !== undefined) return cached;
  const claims = new Map<string, MarloElement[]>();
  const byId = new Map<string, MarloElement>();
  for (const node of walk(root)) {
    const id = attr(node, 'id');
    if (id !== null && id !== '' && !byId.has(id)) byId.set(id, node);
    for (const claimed of normalise(attr(node, 'aria-owns') ?? '').split(' ')) {
      if (claimed === '') continue;
      claims.set(claimed, [...(claims.get(claimed) ?? []), node]);
    }
  }
  const ownership = { claims, byId };
  OWNERSHIP.set(root, ownership);
  return ownership;
}

/** One element owned in the accessibility tree, with the roles it may have. */
interface Owned {
  readonly element: MarloElement;
  readonly answer: RoleAnswer;
  /** Set when an aria-owns relationship around it is ambiguous. */
  readonly doubt?: string;
}

/**
 * What an element owns: its children in the accessibility tree. A child that is not
 * exposed is skipped, one whose role is `none` or `presentation` is looked through to its
 * own children, as the tree does, and text is not an element and is not counted.
 *
 * aria-owns moves elements: a child another element claims leaves, and the elements this
 * one claims join it. An id claimed by more than one element is marked as a doubt,
 * because ARIA leaves the outcome to the browser.
 */
function ownedBy(element: MarloElement, ownership: Ownership): Owned[] {
  const owned: Owned[] = [];
  const take = (child: MarloElement, doubt?: string): void => {
    if (notExposed(child)) return;
    const answer = semanticRoles(child);
    const sole = soleRole(answer);
    if (sole === 'none' || sole === 'presentation') {
      visit(child);
      return;
    }
    owned.push(
      doubt === undefined ? { element: child, answer } : { element: child, answer, doubt },
    );
  };
  const visit = (node: MarloElement): void => {
    for (const child of node.children) {
      const id = attr(child, 'id');
      const claimants = id === null ? [] : (ownership.claims.get(id) ?? []);
      // Claimed by this element too, so it is taken below with the rest of its aria-owns.
      if (claimants.includes(element)) continue;
      if (claimants.length > 0) continue;
      take(child);
    }
  };
  visit(element);
  for (const id of normalise(attr(element, 'aria-owns') ?? '').split(' ')) {
    const target = id === '' ? undefined : ownership.byId.get(id);
    if (target === undefined || target === element) continue;
    const claimants = ownership.claims.get(id) ?? [];
    take(
      target,
      claimants.length > 1
        ? 'more than one element claims it with aria-owns, and ARIA leaves which one owns it to the browser'
        : undefined,
    );
  }
  return owned;
}

function label(owned: Owned): string {
  const roles = owned.answer.kind === 'role' ? owned.answer.roles.join(' or ') : 'no role';
  return `<${owned.element.tag}> (${roles})`;
}

type OwnedVerdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'wrong'; readonly owned: Owned }
  | { readonly kind: 'unsure'; readonly owned: Owned; readonly why: string };

/**
 * Whether every element `element` owns has a permitted role. A definite violation wins
 * over an undecided element, because one wrong owned element is enough to fail.
 */
function checkOwned(
  element: MarloElement,
  permitted: readonly string[],
  through: Readonly<Record<string, readonly string[]>>,
  ownership: Ownership,
  // aria-owns can make a cycle, which ARIA forbids and pages still write.
  seen: ReadonlySet<MarloElement> = new Set([element]),
): OwnedVerdict {
  let unsure: OwnedVerdict | null = null;
  for (const owned of ownedBy(element, ownership)) {
    if (owned.doubt !== undefined || seen.has(owned.element)) {
      unsure ??= {
        kind: 'unsure',
        owned,
        why: owned.doubt ?? 'aria-owns makes the ownership circular',
      };
      continue;
    }
    if (owned.answer.kind !== 'role') {
      unsure ??= {
        kind: 'unsure',
        owned,
        why: 'its role depends on how a browser exposes an element with no corresponding ARIA role',
      };
      continue;
    }
    const verdicts = owned.answer.roles.map((candidate): OwnedVerdict => {
      if (permitted.includes(candidate)) return { kind: 'ok' };
      const inner = through[candidate];
      if (inner === undefined) return { kind: 'wrong', owned };
      // A group may own a group that meets the same requirement.
      const nested = candidate === 'group' ? { ...through, group: inner } : {};
      return checkOwned(owned.element, inner, nested, ownership, new Set([...seen, owned.element]));
    });
    const wrong = verdicts.find((v) => v.kind === 'wrong');
    if (wrong !== undefined && verdicts.every((v) => v.kind === 'wrong')) return wrong;
    if (verdicts.every((v) => v.kind === 'ok')) continue;
    unsure ??= verdicts.find((v) => v.kind === 'unsure') ?? {
      kind: 'unsure',
      owned,
      why: 'its role depends on context Marlo does not resolve, and only some of its possible roles are permitted',
    };
  }
  return unsure ?? { kind: 'ok' };
}

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

/**
 * Required states and properties per role, from ARIA 1.2. `separator` requires
 * `aria-valuenow` only when focusable, which 4e8ab6 checks before reading this table.
 */
const REQUIRED_PROPERTIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  checkbox: ['aria-checked'],
  // ARIA 1.2 redefined combobox as a composite widget that always owns a popup, so
  // both properties are unconditional rather than one implying the other.
  combobox: ['aria-expanded', 'aria-controls'],
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

function ariaAttributesOf(element: { attributes: readonly { name: string; value: string }[] }) {
  return element.attributes.filter((a) => a.name.startsWith('aria-'));
}

/**
 * The role a host-language element carries without any `role` attribute at all, for the
 * handful of elements whose implicit role can collide with one this file checks. Not a
 * full HTML-AAM table: 4e8ab6 only needs to know when an explicit role is redundant with
 * the native one, and a table that under-recognises native roles merely over-applies the
 * rule rather than mis-grading a case, which is the safer gap to leave.
 */
function implicitRole(element: {
  tag: string;
  attributes: readonly { name: string; value: string }[];
}): string | null {
  switch (element.tag) {
    case 'input': {
      const type = (
        element.attributes.find((a) => a.name === 'type')?.value ?? 'text'
      ).toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      return null;
    }
    case 'option':
      return 'option';
    case 'hr':
      return 'separator';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    default:
      return null;
  }
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
    // Valid means a non-abstract role from the WAI-ARIA Specifications, which ACT defines
    // as ARIA 1.2 together with the Graphics and DPUB modules.
    const valid = tokens.filter(
      (t) => ARIA_ROLES.has(t.toLowerCase()) || MODULE_ROLES.has(t.toLowerCase()),
    );
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
  expectation: ({ element }) => {
    const problems: string[] = [];

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
          // One id, and an id never contains whitespace, so two tokens cannot be a
          // value of this type whatever the document holds.
          if (value.includes(' ')) {
            problems.push(
              `${attribute.name}="${value}" must be a single id, and an id cannot contain a space`,
            );
          }
          break;
        case 'id-reference-list':
          // Neither type is checked against the document. The rule's expectation carries
          // an exception: "For value types ID Reference and ID Reference List no ID
          // referenced elements are required." Referring to an element that does not
          // exist has the same effect as no reference at all, and a missing target is
          // in6db8's question, not this rule's.
          break;
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
    return { outcome: 'passed', message: 'Every ARIA value is valid for its attribute type.' };
  },
});

/** How one element's role is described in a message. */
function describeRole(element: MarloElement, answer: RoleAnswer): string {
  if (answer.kind === 'no-role') return `<${element.tag}> (no corresponding ARIA role)`;
  if (answer.kind === 'unknown') return `<${element.tag}>`;
  const roles = answer.roles.join(' or ');
  return attr(element, 'role') === null
    ? `<${element.tag}> (implicit role ${roles})`
    : `role="${roles}"`;
}

/**
 * 5c01ea: every ARIA state or property is permitted where it is used.
 *
 * Permitted means global, or required, supported or inherited by the element's semantic
 * role, or allowed on that HTML element by ARIA in HTML. The semantic role comes from
 * `semanticRoles`, so an element with no role attribute is judged by its implicit role:
 * a `span` is generic and a `label` has no corresponding role, and neither may carry
 * `aria-expanded`. Where the implicit role is not decided here, or several candidates
 * disagree, the answer is `cantTell`. A prohibited global, such as aria-label on a
 * generic element, is still global, and kb1m8s rather than this rule is about it.
 */
export const ariaPropertyPermitted = defineRule({
  actId: '5c01ea',
  name: 'ARIA state or property is permitted',
  successCriteria: ['1.3.1', '4.1.2'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      if (!ariaAttributesOf(element).some((a) => Object.hasOwn(ARIA_ATTRIBUTES, a.name))) continue;
      // Only an element included in the accessibility tree is in scope.
      if (notExposed(element)) continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    const specific = ariaAttributesOf(element)
      .map((a) => a.name)
      .filter((name) => Object.hasOwn(ARIA_ATTRIBUTES, name) && !GLOBAL_ATTRIBUTES.has(name));
    if (specific.length === 0) {
      return {
        outcome: 'passed',
        message: 'Every ARIA attribute here is global, so it is permitted on any element.',
      };
    }

    const answer = semanticRoles(element);
    const who = describeRole(element, answer);
    if (answer.kind === 'unknown') {
      return {
        outcome: 'cantTell',
        message:
          `${specific.join(', ')} ${specific.length === 1 ? 'is' : 'are'} permitted only on some ` +
          `roles, and Marlo does not decide the implicit role of ${who}.`,
      };
    }

    const wrong: string[] = [];
    const unsure: string[] = [];
    for (const name of specific) {
      if (answer.kind === 'no-role') {
        if (!languageFeaturePermits(element, name)) wrong.push(name);
        continue;
      }
      const verdicts = answer.roles.map((r) => rolePermits(r, name, element));
      if (verdicts.every((v) => v === false)) wrong.push(name);
      else if (!verdicts.every((v) => v === true)) unsure.push(name);
    }

    if (wrong.length > 0) {
      return {
        outcome: 'failed',
        message:
          `${wrong.join(', ')} ${wrong.length === 1 ? 'is' : 'are'} not permitted on ${who}, so ` +
          'assistive technology ignores it, and the state or property it was meant to convey ' +
          'is lost.',
      };
    }
    if (unsure.length > 0) {
      return {
        outcome: 'cantTell',
        message:
          `Whether ${unsure.join(', ')} ${unsure.length === 1 ? 'is' : 'are'} permitted on ${who} ` +
          'depends on which of those roles it takes, which the DOM does not settle.',
      };
    }
    return {
      outcome: 'passed',
      message: `${specific.join(', ')} ${specific.length === 1 ? 'is' : 'are'} permitted on ${who}.`,
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
      if (
        role !== null &&
        Object.hasOwn(REQUIRED_PROPERTIES, role) &&
        implicitRole(element) !== role
      ) {
        if (!isHiddenFromAssistiveTech(element)) targets.push({ element });
      }
    }
    return targets;
  },
  expectation: ({ element }) => {
    const role = explicitRole(element) ?? '';
    // ARIA 1.2 requires aria-valuenow on a separator only "if focusable": a focusable
    // separator is a widget that moves, and a static one is structure with no value.
    if (role === 'separator' && !canReceiveFocus(element)) {
      return {
        outcome: 'passed',
        message:
          'role="separator" is not focusable, so it is a static divider and ARIA 1.2 requires ' +
          'no value on it.',
      };
    }
    const required = REQUIRED_PROPERTIES[role] ?? [];
    // "Set and not empty", per the rule's expectation text: an attribute present with an
    // empty value has not supplied the property any more than an absent one has.
    const missing = required.filter((name) => {
      const value = attr(element, name);
      return value === null || value === '';
    });
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

/**
 * bc4a75: an element whose role requires owned elements owns only those.
 *
 * The rule applies to the semantic role, so a `ul` is a list and a `table` a table with
 * no role attribute at all, and it applies only to the WAI-ARIA 1.2 roles with required
 * owned elements. Its expectation is "only owns", so one owned element of another role
 * fails it, and an element that owns nothing does not.
 */
export const requiredOwnedElements = defineRule({
  actId: 'bc4a75',
  name: 'ARIA required owned elements',
  successCriteria: ['1.3.1'],
  requires: ['dom'],
  fixability: 'never',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      const role = soleRole(semanticRoles(element));
      if (role === null || !Object.hasOwn(REQUIRED_OWNED, role)) continue;
      if (notExposed(element)) continue;
      // "Except if the element has an inclusive ancestor in the accessibility tree with an
      // aria-busy attribute value of true": its content is still being assembled.
      if ([element, ...ancestors(element)].some((a) => attr(a, 'aria-busy') === 'true')) continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    const role = soleRole(semanticRoles(element)) ?? '';
    const requirement = REQUIRED_OWNED[role] ?? { direct: [] };
    const named = attr(element, 'role') === null ? `<${element.tag}> (${role})` : `role="${role}"`;

    const allowed = [...requirement.direct, ...Object.keys(requirement.through ?? {})];
    const verdict = checkOwned(
      element,
      requirement.direct,
      requirement.through ?? {},
      ownershipOf(document.root),
    );

    if (verdict.kind === 'wrong') {
      return {
        outcome: 'failed',
        message:
          `${named} may own only ${allowed.join(', ')}, and it owns ${label(verdict.owned)}. ` +
          'A screen reader announcing the structure reports the wrong number of items, or ' +
          'none, and the ARIA 1.2 relationship it relies on is broken.',
      };
    }
    if (verdict.kind === 'unsure') {
      return {
        outcome: 'cantTell',
        message:
          `${named} may own only ${allowed.join(', ')}. It owns ${label(verdict.owned)}, and ` +
          `whether that is permitted is not settled here: ${verdict.why}.`,
      };
    }
    return {
      outcome: 'passed',
      message: `Everything ${named} owns has one of the roles ARIA 1.2 permits: ${allowed.join(', ')}.`,
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
    // "Focusable and part of the sequential focus navigation": an element that is not
    // rendered, is hidden by visibility, is inert or is disabled is in neither, whatever
    // its tag or tabindex says. Display is read from resolved styles where the renderer
    // has them; without them a stylesheet-hidden element still counts, so this rule can
    // over-report on the static renderer and cannot under-report. See `isNotRendered`.
    const focusable = [...walk(element)].filter((node) => isInSequentialFocusOrder(node));
    if (focusable.length === 0) {
      return {
        outcome: 'passed',
        message: 'Nothing inside the hidden element is in the sequential focus order.',
      };
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
