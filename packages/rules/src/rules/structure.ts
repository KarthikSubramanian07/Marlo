import { defineRule } from '../define.js';
import { attr, findAll, findFirst, normalise, walk } from '../dom.js';

/** Structural and metadata rules. The most reliably auto-fixable group after language. */

/** 36b590: Error message describes invalid form field value. */
export const errorMessageDescribesInvalidValue = defineRule({
  actId: '36b590',
  name: 'Error message describes invalid form field value',
  successCriteria: ['3.3.1'],
  requires: ['dom'],
  fixability: 'context-dependent',

  applicability: (document) => {
    const APPLICABLE_ROLES = new Set([
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

    const targets: { element: typeof document.root }[] = [];
    for (const element of walk(document.root)) {
      let role = (attr(element, 'role') ?? '').toLowerCase();

      // Infers the role for blank roles
      if (!role) {
        if (element.tag === 'select') role = 'combobox';
        else if (element.tag === 'textarea') role = 'textbox';
        else if (element.tag === 'input') {
          const type = (attr(element, 'type') ?? 'text').toLowerCase();
          if (type === 'checkbox') role = 'checkbox';
          else if (type === 'radio') role = 'radio';
          else if (type === 'search') role = 'searchbox';
          else if (type === 'number') role = 'spinbutton';
          else if (['text', 'email', 'password', 'tel', 'url'].includes(type)) role = 'textbox';
        }
      }

      if (APPLICABLE_ROLES.has(role)) {
        // Must have an associated error message to be applicable
        const errorId = attr(element, 'aria-errormessage') ?? attr(element, 'aria-describedby');
        if (!errorId) continue;

        const ids = errorId.split(/\s+/);
        let errorElementExists = false;
        for (const node of walk(document.root)) {
          const nodeVal = attr(node, 'id');
          if (nodeVal && ids.includes(nodeVal)) {
            errorElementExists = true;
            break;
          }
        }

        if (errorElementExists) {
          targets.push({ element });
        }
      }
    }
    return targets;
  },

  expectation: ({ element }, document) => {
    const errorId = attr(element, 'aria-errormessage') ?? attr(element, 'aria-describedby');

    let errorElement = null;
    if (errorId) {
      const ids = errorId.split(/\s+/);
      for (const node of walk(document.root)) {
        const nodeVal = attr(node, 'id');
        if (nodeVal && ids.includes(nodeVal)) {
          errorElement = node;
          break;
        }
      }
    }

    if (!errorElement) {
      return {
        outcome: 'inapplicable',
        message: 'No associated error element found.',
      };
    }

    // Checks if visible to screen-readers
    if (attr(errorElement, 'aria-hidden') === 'true') {
      return {
        outcome: 'failed',
        message:
          'The associated error message is hidden from the accessibility tree via aria-hidden="true".',
      };
    }

    // Checks for basic CSS visibility
    const style = (attr(errorElement, 'style') ?? '').toLowerCase();
    if (
      style.includes('display: none') ||
      style.includes('display:none') ||
      style.includes('visibility: hidden')
    ) {
      return {
        outcome: 'failed',
        message:
          'The associated error message is not visible (CSS display:none or visibility:hidden).',
      };
    }

    // Message quality check
    const errorText = normalise(errorElement.text);

    // Heuristic patterns against various generic error phrases
    const GENERIC_ERROR_PATTERNS = [
      /^(error|invalid|warning|failed|alert|problem|wrong)\.?$/i,
      /^(this\s+)?field\s+is\s+invalid\.?$/i,
      /^invalid\s+(value|input|data|entry|format|selection)\.?$/i,
      /^please\s+(fill|enter|provide|fix)\s+(the|this)?\s*(field|correct\s+text|correct\s+value|valid\s+data)\.?$/i,
      /^please\s+enter\s+a\s+valid\s+value\.?$/i,
      /^please\s+correct\s+the\s+error(s)?\.?$/i,
      /^(this\s+field\s+is\s+)?required\.?$/i,
      /^validation\s+failed\.?$/i,
    ];

    function isGenericErrorText(rawText: string): boolean {
      const text = normalise(rawText).trim();
      if (text.length <= 2) return true;
      return GENERIC_ERROR_PATTERNS.some((pattern) => pattern.test(text));
    }

    if (isGenericErrorText(errorText)) {
      return {
        outcome: 'failed',
        message: `Error message "${errorText}" is generic and does not describe the cause of the error or how to resolve it.`,
      };
    }

    return {
      outcome: 'passed',
      message: 'The error message describes the error and is exposed to assistive technologies.',
    };
  },
});

/** 3ea0c8: every id attribute value is unique. */
export const uniqueId = defineRule({
  actId: '3ea0c8',
  name: 'Id attribute value is unique',
  successCriteria: ['4.1.1'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      const id = attr(element, 'id');
      if (id !== null && normalise(id) !== '') targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    const id = attr(element, 'id') ?? '';
    let count = 0;
    for (const node of walk(document.root)) {
      if (attr(node, 'id') === id) count += 1;
    }
    if (count === 1) return { outcome: 'passed', message: `id="${id}" is unique.` };
    return {
      outcome: 'failed',
      message:
        `id="${id}" appears ${String(count)} times. Every reference to it, including a label\'s ` +
        'for and any aria-labelledby, resolves to the first one only.',
    };
  },
});

/** e6952f: no attribute is duplicated on an element. */
export const noDuplicateAttribute = defineRule({
  actId: 'e6952f',
  name: 'Attribute is not duplicated',
  successCriteria: ['4.1.1'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => [...walk(document.root)].map((element) => ({ element })),
  expectation: ({ element }) => {
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const attribute of element.attributes) {
      if (seen.has(attribute.name)) duplicated.add(attribute.name);
      seen.add(attribute.name);
    }
    if (duplicated.size === 0) {
      return { outcome: 'passed', message: 'No attribute is duplicated.' };
    }
    return {
      outcome: 'failed',
      message:
        `${[...duplicated].join(', ')} appears more than once. The parser keeps the first and ` +
        'silently discards the rest, so the later value looks applied and is not.',
    };
  },
});

function metaRefreshDelay(content: string): { delay: number; hasUrl: boolean } | null {
  // content is `delay` or `delay;url=...`, per HTML.
  const match = /^\s*(\d+)\s*(?:;\s*url\s*=\s*(.+))?\s*$/i.exec(content);
  if (match === null) return null;
  const delay = Number.parseInt(match[1] ?? '', 10);
  if (Number.isNaN(delay)) return null;
  return { delay, hasUrl: match[2] !== undefined };
}

/** bc659a: meta refresh has no delay, or a delay over 20 hours. */
export const metaRefreshNoDelay = defineRule({
  actId: 'bc659a',
  name: 'Meta element has no refresh delay',
  successCriteria: ['2.2.1', '2.2.4', '3.2.5'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, ['meta'])) {
      if ((attr(element, 'http-equiv') ?? '').toLowerCase() !== 'refresh') continue;
      const content = attr(element, 'content');
      if (content === null || metaRefreshDelay(content) === null) continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    const parsed = metaRefreshDelay(attr(element, 'content') ?? '');
    if (parsed === null) return { outcome: 'inapplicable', message: 'Not a refresh directive.' };
    // The ACT rule's exception: a delay over 20 hours is effectively never, so the user
    // is not interrupted.
    if (parsed.delay === 0) {
      return {
        outcome: 'passed',
        message: 'The refresh is immediate, which the rule permits as a redirect.',
      };
    }
    if (parsed.delay > 72_000) {
      return {
        outcome: 'passed',
        message: `A delay of ${String(parsed.delay)} seconds is over 20 hours, which the rule permits.`,
      };
    }
    return {
      outcome: 'failed',
      message:
        `The page refreshes after ${String(parsed.delay)} seconds. Anyone reading slowly, or using ` +
        'a screen reader, loses their place with no way to stop it.',
    };
  },
});

/** bisz58: the same rule without the long-delay exception. */
export const metaRefreshStrict = defineRule({
  actId: 'bisz58',
  name: 'Meta element has no refresh delay (no exception)',
  successCriteria: ['2.2.1', '2.2.4', '3.2.5'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, ['meta'])) {
      if ((attr(element, 'http-equiv') ?? '').toLowerCase() !== 'refresh') continue;
      const content = attr(element, 'content');
      if (content === null || metaRefreshDelay(content) === null) continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    const parsed = metaRefreshDelay(attr(element, 'content') ?? '');
    if (parsed === null) return { outcome: 'inapplicable', message: 'Not a refresh directive.' };
    if (parsed.delay === 0) {
      return { outcome: 'passed', message: 'The refresh is immediate.' };
    }
    // No exception here: that is the whole difference between this rule and bc659a.
    return {
      outcome: 'failed',
      message: `The page refreshes after ${String(parsed.delay)} seconds. This rule allows no exception for a long delay.`,
    };
  },
});

/** b4f0c3: the viewport meta tag allows zoom. */
export const viewportAllowsZoom = defineRule({
  actId: 'b4f0c3',
  name: 'Meta viewport allows for zoom',
  successCriteria: ['1.4.4', '1.4.10'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, ['meta'])) {
      if ((attr(element, 'name') ?? '').toLowerCase() !== 'viewport') continue;
      if (attr(element, 'content') === null) continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    const content = (attr(element, 'content') ?? '').toLowerCase();
    const directives = new Map<string, string>();
    for (const part of content.split(',')) {
      const [key, value] = part.split('=').map((s) => s.trim());
      if (key !== undefined && value !== undefined) directives.set(key, value);
    }

    const problems: string[] = [];
    const userScalable = directives.get('user-scalable');
    if (userScalable !== undefined && ['no', '0', 'false'].includes(userScalable)) {
      problems.push('user-scalable=no prevents pinch zoom entirely');
    }
    const maximumScale = directives.get('maximum-scale');
    if (maximumScale !== undefined) {
      const scale = Number.parseFloat(maximumScale);
      // The ACT rule's threshold: below 2 is a failure, because 200 percent is what
      // 1.4.4 requires.
      if (!Number.isNaN(scale) && scale < 2) {
        problems.push(`maximum-scale=${maximumScale} caps zoom below the 200 percent required`);
      }
    }

    if (problems.length === 0) {
      return {
        outcome: 'passed',
        message: 'The viewport permits zooming to at least 200 percent.',
      };
    }
    return {
      outcome: 'failed',
      message:
        `${problems.join(', and ')}. Anyone who needs larger text on a phone cannot get it, and ` +
        'this is one of the few violations that is trivially fixable.',
    };
  },
});

/** e88epe: an image not in the accessibility tree is decorative. */
export const decorativeImageNotExposed = defineRule({
  actId: 'e88epe',
  name: 'Image not in the accessibility tree is decorative',
  successCriteria: ['1.1.1'],
  requires: ['dom'],
  fixability: 'never',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, ['img'])) {
      // Applies to images removed from the tree, whether by aria-hidden, role, or an
      // empty alt.
      const role = (attr(element, 'role') ?? '').toLowerCase();
      const hidden =
        attr(element, 'aria-hidden') === 'true' ||
        role === 'presentation' ||
        role === 'none' ||
        attr(element, 'alt') === '';
      if (hidden) targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    // Whether an image is genuinely decorative is a judgment about the page's meaning.
    // Marlo does not have that judgment and says so, per D-009: a confident wrong
    // answer here is worse than an absent one, in both directions.
    const src = attr(element, 'src') ?? '';
    return {
      outcome: 'cantTell',
      message:
        `This image is hidden from assistive technology${src === '' ? '' : ` (${src})`}. Whether ` +
        'that is correct depends on whether it carries meaning, which is a judgment about the ' +
        'page rather than about the markup. Marlo does not guess either way.',
    };
  },
});

/** 46ca7f: an element marked decorative is not exposed anyway. */
export const decorativeNotExposed = defineRule({
  actId: '46ca7f',
  name: 'Element marked as decorative is not exposed',
  successCriteria: ['1.1.1'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const targets = [];
    for (const element of walk(document.root)) {
      const role = (attr(element, 'role') ?? '').toLowerCase();
      const decorative =
        role === 'presentation' ||
        role === 'none' ||
        (element.tag === 'img' && attr(element, 'alt') === '');
      if (decorative) targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    // A global ARIA attribute or focusability defeats role="presentation": the element
    // comes back into the tree with the role stripped, which is worse than either
    // intention.
    const globals = element.attributes
      .map((a) => a.name)
      .filter((name) => name.startsWith('aria-') && name !== 'aria-hidden');
    const tabindex = attr(element, 'tabindex');

    const reasons: string[] = [];
    if (globals.length > 0) reasons.push(`it carries ${globals.join(', ')}`);
    if (tabindex !== null && Number.parseInt(tabindex, 10) >= 0) {
      reasons.push(`tabindex="${tabindex}" puts it in the focus order`);
    }

    if (reasons.length === 0) {
      return { outcome: 'passed', message: 'The element is genuinely removed from the tree.' };
    }
    return {
      outcome: 'failed',
      message:
        `This element is marked decorative but ${reasons.join(' and ')}, which puts it back in the ` +
        'accessibility tree with its role stripped. It ends up announced as a generic element.',
    };
  },
});

/** 9eb3f6: the accessible name of an image is not its filename. */
export const filenameNotName = defineRule({
  actId: '9eb3f6',
  name: 'Image filename is accessible name for image',
  successCriteria: ['1.1.1'],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, ['img'])) {
      const alt = attr(element, 'alt');
      const src = attr(element, 'src');
      if (alt === null || normalise(alt) === '' || src === null) continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    const alt = normalise(attr(element, 'alt') ?? '');
    const src = attr(element, 'src') ?? '';
    const filename = (src.split(/[?#]/)[0] ?? '').split('/').pop() ?? '';
    const stem = filename.replace(/\.[a-z0-9]+$/i, '');

    const matchesFilename =
      alt.toLowerCase() === filename.toLowerCase() || alt.toLowerCase() === stem.toLowerCase();

    if (!matchesFilename) {
      return { outcome: 'passed', message: `The alt text is not the filename.` };
    }
    // The ACT rule permits a filename that is genuinely descriptive, which is a
    // judgment Marlo does not make. So a match is cantTell rather than failed.
    return {
      outcome: 'cantTell',
      message:
        `The alt text is "${alt}", which is the filename. That is usually a placeholder, but the ` +
        'rule allows a filename that genuinely describes the image, and deciding which this is ' +
        'requires looking at the image.',
    };
  },
});

/** 5b7ae0 lives in language.ts; this file keeps the head-only structural checks. */
export const documentHasHeadTitleElement = findFirst;
