import { defineRule } from '../define.js';
import type { MarloDocument, MarloElement } from '../dom.js';
import { ancestors, attr, hasAttr, isHiddenFromAssistiveTech, normalise, walk } from '../dom.js';
import { explicitRole } from './aria.js';

/**
 * Form rules. The first of them is a rule that mostly declines, on purpose.
 *
 * 36b590 asks whether an error message identifies the field it is about and describes
 * what went wrong. That is a question about the meaning of a sentence, and the ACT rule
 * lists "Language" among its input aspects for exactly that reason. Marlo's rules are
 * pure functions over the DOM with no language model behind them, so this rule decides
 * three things and no more:
 *
 *   which elements are form fields, from their role;
 *   which content is a candidate error indicator, from how the page is wired;
 *   whether that content can be perceived, visually and in the accessibility tree.
 *
 * Whether the words describe the cause is `cantTell`, with the candidate text quoted so
 * the person reading the report can answer in a second. That is the semi-automated
 * answer, and it is the true one.
 *
 * A PHRASE LIST WAS TRIED FIRST AND IS THE WRONG SHAPE, WHICH IS WORTH WRITING DOWN.
 *
 * The obvious implementation grades the sentence against a list of generic phrases
 * ("please enter a valid value", "this field is required"). It fails in both directions
 * at once. Every real error message not on the list passes, so recall is a function of
 * how long the list is rather than of anything about the page. And the list flags
 * "Required" beside a field on a page where "Required" is the hint rather than the
 * error, which is a false positive on markup that is fine. The strict view cannot tell
 * a cantTell from a miss and records both as recall zero, so the phrase list buys a
 * number that looks the same and is no longer true.
 */

/** The semantic roles 36b590 applies to, copied from the rule rather than from memory. */
const FIELD_ROLES: ReadonlySet<string> = new Set([
  'checkbox',
  'combobox',
  'listbox',
  'menuitemcheckbox',
  'menuitemradio',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'textbox',
]);

/**
 * Input types whose implicit role is one of the roles above, per HTML-AAM.
 *
 * `password` is deliberately absent. HTML-AAM gives it no corresponding role, so it is
 * not one of the roles 36b590 applies to, and treating it as a textbox would put a
 * field the rule does not cover on the one path that can fail.
 *
 * Null prototype, because this is looked up with a value read out of the document. With
 * an ordinary object literal, `<input type="constructor">` returns `Object` and
 * `type="__proto__"` returns the prototype, from a function declared to return a string
 * or null.
 */
const INPUT_ROLES: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, string>, {
    checkbox: 'checkbox',
    email: 'textbox',
    number: 'spinbutton',
    radio: 'radio',
    range: 'slider',
    search: 'searchbox',
    tel: 'textbox',
    text: 'textbox',
    url: 'textbox',
  }),
);

/**
 * Input types with a role that is not a form field for this rule's purposes, listed
 * rather than inferred.
 *
 * The distinction matters because HTML says an unrecognised `type` is treated as
 * `text`, so an unknown type has to fall through to `textbox` rather than to nothing.
 * Without the list, `<input type="button">` would be graded as a text field.
 */
const NON_FIELD_INPUTS: ReadonlySet<string> = new Set([
  'button',
  'color',
  'date',
  'datetime-local',
  'file',
  'hidden',
  'image',
  'month',
  'password',
  'reset',
  'submit',
  'time',
  'week',
]);

/**
 * The field role of an element, or null when it has none.
 *
 * An explicit role wins, which is how the role attribute works. Without one the role
 * comes from the tag, and for an input from its type. An input or select carrying a
 * `list` attribute is a combobox in HTML-AAM, and a select is a listbox rather than a
 * combobox once it is `multiple` or sized above one row.
 */
export function fieldRole(element: MarloElement): string | null {
  const explicit = explicitRole(element);
  if (explicit !== null) return FIELD_ROLES.has(explicit) ? explicit : null;

  switch (element.tag) {
    case 'textarea':
      return 'textbox';
    case 'select': {
      const size = Number.parseInt(attr(element, 'size') ?? '1', 10);
      return hasAttr(element, 'multiple') || size > 1 ? 'listbox' : 'combobox';
    }
    case 'input': {
      const type = (attr(element, 'type') ?? 'text').toLowerCase();
      if (NON_FIELD_INPUTS.has(type)) return null;
      const role = INPUT_ROLES[type] ?? 'textbox';
      if ((role === 'textbox' || role === 'searchbox') && hasAttr(element, 'list')) {
        return 'combobox';
      }
      return role;
    }
    default:
      return null;
  }
}

/** The nearest form ancestor, or the document root when the field is not in a form. */
function scopeOf(element: MarloElement, document: MarloDocument): MarloElement {
  return ancestors(element).find((a) => a.tag === 'form') ?? document.root;
}

/**
 * Every element in the document, indexed by id, built once per document.
 *
 * `referenced` used to walk the whole tree per lookup, and `candidatesFor` looks up
 * every `aria-describedby` in scope, once per field. On a form of 200 labelled fields
 * with the hint text that pattern recommends, that was 1800 nodes walked 200 times over
 * and the rule took half a minute. AGENTS.md says to cap anything unbounded, and this
 * was unbounded in the shape a well-marked-up page has most of.
 *
 * Keyed on the root element in a WeakMap, so it lives exactly as long as the document
 * and no rule can see another document's index.
 */
const ID_INDEX = new WeakMap<MarloElement, ReadonlyMap<string, readonly MarloElement[]>>();

function idIndex(document: MarloDocument): ReadonlyMap<string, readonly MarloElement[]> {
  const cached = ID_INDEX.get(document.root);
  if (cached !== undefined) return cached;
  const index = new Map<string, MarloElement[]>();
  for (const node of walk(document.root)) {
    const id = attr(node, 'id');
    if (id === null || id === '') continue;
    const found = index.get(id);
    if (found === undefined) index.set(id, [node]);
    else found.push(node);
  }
  ID_INDEX.set(document.root, index);
  return index;
}

/** The id tokens in an IDREF list attribute. Empty when the attribute names nothing. */
function idTokens(ids: string): readonly string[] {
  return normalise(ids)
    .split(' ')
    .filter((id) => id !== '');
}

/** Every element carrying one of the given ids, in document order. */
function referenced(ids: string, document: MarloDocument): MarloElement[] {
  const wanted = idTokens(ids);
  if (wanted.length === 0) return [];
  const index = idIndex(document);
  const out: MarloElement[] = [];
  for (const id of wanted) out.push(...(index.get(id) ?? []));
  return out;
}

/** The `aria-invalid` values that mean this field is in error right now. */
function isInvalid(element: MarloElement): boolean {
  const value = (attr(element, 'aria-invalid') ?? '').trim().toLowerCase();
  return value === 'true' || value === 'grammar' || value === 'spelling';
}

/**
 * Hidden from sight, as far as the DOM can tell: the `hidden` attribute, or
 * `display: none` or `visibility: hidden` in a style attribute, on the element or an
 * ancestor. `aria-hidden` is deliberately not part of this. It hides from assistive
 * technology and leaves the pixels alone, and the rule's second and third expectations
 * ask about those separately.
 */
function isVisuallyHidden(element: MarloElement): boolean {
  for (const node of [element, ...ancestors(element)]) {
    if (hasAttr(node, 'hidden')) return true;
    const style = attr(node, 'style');
    if (style === null) continue;
    // `display: none` removes the subtree and no descendant can undo it.
    if (/(?:^|;)\s*display\s*:\s*none\s*(?:!\s*important)?\s*(?:;|$)/i.test(style)) return true;
    // `visibility` inherits and a descendant may set it back to `visible`, so the
    // nearest declaration wins rather than the first hidden one found on the way up.
    const visibility = /(?:^|;)\s*visibility\s*:\s*([a-z]+)/i.exec(style);
    if (visibility !== null) return visibility[1]?.toLowerCase() !== 'visible';
  }
  return false;
}

/**
 * Whether an element carries text a reader could receive, counting text alternatives.
 *
 * `element.text` is concatenated descendant text and knows nothing about `alt`, so an
 * error message rendered as an image with alt text read as having no text at all, and
 * that was enough on its own to fail the field.
 */
function hasPerceivableText(element: MarloElement): boolean {
  if (normalise(element.text) !== '') return true;
  for (const node of walk(element)) {
    for (const name of ['alt', 'aria-label', 'title']) {
      const value = attr(node, name);
      if (value !== null && normalise(value) !== '') return true;
    }
  }
  return false;
}

/**
 * Whether an id or class token says this element carries an error.
 *
 * A convention rather than a specification, and it decides only what to quote back at a
 * reader, never what to fail. The tokens are the ones the corpus and the common form
 * libraries use, including compounds such as `field-error` and `is-invalid`.
 */
function namedAsError(element: MarloElement): boolean {
  const names = `${attr(element, 'id') ?? ''} ${attr(element, 'class') ?? ''}`.toLowerCase();
  return /error|invalid|validation/.test(names);
}

interface Candidate {
  readonly element: MarloElement;
  /** How the page connects this content to an error, in the author's own terms. */
  readonly how: string;
}

/**
 * Content that may be a form field error indicator for this field.
 *
 * Three connections count, and each is something the author wrote rather than something
 * inferred from prose: the field's own `aria-errormessage` while it reports itself
 * invalid, an alert or assertive live region inside the same form, and an element whose
 * id or class names it as an error inside the same form.
 *
 * Content hidden from sight counts only when something references it through
 * `aria-describedby`. A referenced hidden element is still read out as part of a
 * description; an unreferenced one is usually the empty slot a form renders its message
 * into after submission, and quoting that at a reader would mean quoting it on every
 * framework form on the web before anybody had typed anything.
 */
const SCOPE_CANDIDATES = new WeakMap<MarloElement, readonly Candidate[]>();

/**
 * The candidate error indicators inside one form, computed once for that form.
 *
 * Cached on the scope rather than on the field, because every field in a form produces
 * the same list. The field's own exclusion is applied by the caller, after the cache,
 * so the shared result stays correct for each of them.
 */
function candidatesInScope(scope: MarloElement, document: MarloDocument): readonly Candidate[] {
  const cached = SCOPE_CANDIDATES.get(scope);
  if (cached !== undefined) return cached;

  const seen = new Set<MarloElement>();
  const out: Candidate[] = [];
  const add = (element: MarloElement, how: string): void => {
    if (element === scope || seen.has(element)) return;
    if (!hasPerceivableText(element)) return;
    seen.add(element);
    out.push({ element, how });
  };

  const describedInScope = new Set<MarloElement>();
  for (const node of walk(scope)) {
    const describedby = attr(node, 'aria-describedby');
    if (describedby !== null) {
      for (const element of referenced(describedby, document)) describedInScope.add(element);
    }
    const errorMessage = attr(node, 'aria-errormessage');
    if (errorMessage !== null && isInvalid(node)) {
      for (const element of referenced(errorMessage, document)) {
        add(element, 'aria-errormessage on a field reporting itself invalid');
      }
    }
  }

  for (const node of walk(scope)) {
    const role = explicitRole(node);
    const live = (attr(node, 'aria-live') ?? '').trim().toLowerCase();
    if (role !== 'alert' && live !== 'assertive' && !namedAsError(node)) continue;
    if (isVisuallyHidden(node) && !describedInScope.has(node)) continue;
    add(
      node,
      role === 'alert'
        ? 'role="alert" in the same form'
        : live === 'assertive'
          ? 'an assertive live region in the same form'
          : describedInScope.has(node)
            ? 'named as an error and referenced by aria-describedby'
            : 'named as an error by its id or class',
    );
  }

  SCOPE_CANDIDATES.set(scope, out);
  return out;
}

/**
 * Content that may be a form field error indicator for this field.
 *
 * Three connections count, and each is something the author wrote rather than something
 * inferred from prose: an `aria-errormessage` on a field reporting itself invalid, an
 * alert or assertive live region inside the same form, and an element whose id or class
 * names it as an error inside the same form.
 *
 * Content hidden from sight counts only when something references it through
 * `aria-describedby`. A referenced hidden element is still read out as part of a
 * description; an unreferenced one is usually the empty slot a form renders its message
 * into after submission, and quoting that at a reader would mean quoting it on every
 * framework form on the web before anybody had typed anything.
 */
function candidatesFor(field: MarloElement, document: MarloDocument): readonly Candidate[] {
  return candidatesInScope(scopeOf(field, document), document).filter((c) => c.element !== field);
}

function quote(element: MarloElement): string {
  const text = normalise(element.text);
  return text.length <= 100 ? `"${text}"` : `"${text.slice(0, 99)}…"`;
}

/** Why a candidate cannot be perceived, or null when it can. */
function unperceivable(element: MarloElement): string | null {
  if (isVisuallyHidden(element)) return 'not visible';
  if (isHiddenFromAssistiveTech(element)) return 'not in the accessibility tree';
  return null;
}

/** 36b590: an error message describes the invalid form field value. */
export const errorMessageDescribesValue = defineRule({
  actId: '36b590',
  name: 'Error message describes invalid form field value',
  successCriteria: ['3.3.1'],
  requires: ['dom'],
  // Writing an error message is writing content. No mechanical edit supplies one.
  fixability: 'never',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      if (fieldRole(element) === null) continue;
      if (isHiddenFromAssistiveTech(element)) continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    // The one shape the DOM settles outright. The field reports itself invalid and names
    // its error message, and every element it names is missing, empty, or hidden. The
    // message the author bound to this error cannot be perceived, whatever it says.
    //
    // Nothing weaker may fail here. A hidden element with error text and no
    // `aria-invalid` is the ordinary pre-rendered validation message every form library
    // emits, waiting to be shown, and failing that would flag almost every form on the
    // web. `aria-invalid` is what distinguishes an error that is live now.
    const candidates = candidatesFor(element, document);
    const errorMessage = attr(element, 'aria-errormessage');
    const named = errorMessage === null ? [] : idTokens(errorMessage);

    // An attribute present with no id in it names nothing, so the field is in the same
    // position as one with no attribute at all. `aria-errormessage={id ?? ''}` renders
    // exactly that on every valid field in a great many frameworks, and reading it as a
    // broken reference failed a whole form of correctly marked-up fields.
    if (named.length > 0 && isInvalid(element)) {
      const messages = referenced(errorMessage ?? '', document);
      const perceivable = messages.filter(
        (m) => hasPerceivableText(m) && unperceivable(m) === null,
      );
      // And only when nothing else in the form is showing the error either. A typo in
      // one IDREF, next to a live `role="alert"` carrying the text, is a broken
      // reference rather than an error that reaches nobody, and which of those it is
      // depends on reading the alert, which is the judgment this rule does not make.
      const elsewhere = candidates.filter((c) => unperceivable(c.element) === null);
      if (perceivable.length === 0 && elsewhere.length === 0) {
        const first = messages[0];
        const why =
          first === undefined
            ? `aria-errormessage="${errorMessage ?? ''}" refers to no element in this document`
            : messages.every((m) => !hasPerceivableText(m))
              ? 'the element it refers to has no text and no text alternative'
              : `the element it refers to is ${unperceivable(first) ?? 'hidden'}`;
        return {
          outcome: 'failed',
          message:
            `The field reports itself invalid and ${why}, so the error message the page bound ` +
            'to it reaches nobody. Show the message, and keep it in the accessibility tree.',
        };
      }
    }

    if (candidates.length === 0) {
      if (isInvalid(element)) {
        return {
          outcome: 'cantTell',
          message:
            'The field reports itself invalid and nothing in the form is wired up as its error ' +
            'message. If the error is shown by colour, an icon or position alone, the field ' +
            'fails this rule: the cause has to be described in text.',
        };
      }
      return {
        outcome: 'passed',
        message:
          'No error indicator is present for this field as rendered. A message that appears ' +
          'only after submission has to be checked in that state.',
      };
    }

    const described = candidates
      .slice(0, 3)
      .map((candidate) => {
        const why = unperceivable(candidate.element);
        const warning = why === null ? '' : ` (${why}, so if this is the error it fails)`;
        return `${quote(candidate.element)} via ${candidate.how}${warning}`;
      })
      .join('; ');
    const more = candidates.length > 3 ? ` and ${String(candidates.length - 3)} more` : '';
    return {
      outcome: 'cantTell',
      message:
        `Possible error indicator${candidates.length === 1 ? '' : 's'}: ${described}${more}. ` +
        'Whether that text names this field and describes the cause of the error, or how to ' +
        'fix it, is a judgment about language that Marlo does not make. Read it and decide.',
    };
  },
});
