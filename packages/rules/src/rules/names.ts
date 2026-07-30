import { defineRule } from '../define.js';
import { accessibleName } from '../accname.js';
import { attr, findAll, hasAttr, isHiddenFromAssistiveTech, normalise } from '../dom.js';
import { explicitRole } from './aria.js';

/**
 * The accessible name rules.
 *
 * Every one of these returns `cantTell` when the name computation was uncertain, and
 * the accname module explains why in the message. That is a deliberate trade: Marlo's
 * recall on this category will be lower than a browser-backed engine's, because a
 * complete accessible name computation needs layout and generated content. The
 * calibration table publishes that cost, the router sends these rules to whichever peer
 * measures better, and nobody has to take Marlo's word for anything.
 *
 * None of them is `auto` fixable. A missing name is only fixable where the page itself
 * supplies the meaning, which is [D-009](../../../../DECISIONS.md#d-009), and deciding
 * that is the repair layer's job rather than the rule's.
 */

function nameRule(options: {
  actId: Parameters<typeof defineRule>[0]['actId'];
  name: string;
  successCriteria: readonly `${number}.${number}.${number}`[];
  tags: readonly string[];
  nameFromContent: boolean;
  /** Extra applicability beyond the tag, for rules with a narrower scope. */
  applies?: (element: Parameters<typeof accessibleName>[0]) => boolean;
  subject: string;
  consequence: string;
}) {
  return defineRule({
    actId: options.actId,
    name: options.name,
    successCriteria: [...options.successCriteria],
    requires: ['dom'],
    fixability: 'context-dependent',
    applicability: (document) => {
      const targets = [];
      for (const element of findAll(document, options.tags)) {
        if (isHiddenFromAssistiveTech(element)) continue;
        if (options.applies !== undefined && !options.applies(element)) continue;
        targets.push({ element });
      }
      return targets;
    },
    expectation: ({ element }, document) => {
      const computed = accessibleName(element, document, {
        nameFromContent: options.nameFromContent,
      });

      if (computed.name !== '') {
        return {
          outcome: 'passed',
          message: `${options.subject} is named "${computed.name}" via ${computed.from}.`,
        };
      }
      if (computed.confidence === 'uncertain') {
        return {
          outcome: 'cantTell',
          message:
            `Marlo could not compute a reliable accessible name for ${options.subject}. ` +
            `${computed.reason ?? ''} Reporting a failure here could be a false positive.`,
        };
      }
      return {
        outcome: 'failed',
        message: `${options.subject} has no accessible name. ${options.consequence}`,
      };
    },
  });
}

/** 23a2a8: an image has a non-empty accessible name. */
export const imageHasName = defineRule({
  actId: '23a2a8',
  name: 'Image has non-empty accessible name',
  successCriteria: ['1.1.1'],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, ['img', 'svg', 'div', 'span'])) {
      if (isHiddenFromAssistiveTech(element)) continue;
      const role = explicitRole(element);
      const isImage =
        element.tag === 'img' ? role !== 'presentation' && role !== 'none' : role === 'img';
      if (!isImage) continue;
      // An img with alt="" is marked decorative, which e88epe and 46ca7f cover. This
      // rule applies only to images that are in the accessibility tree as images.
      if (element.tag === 'img' && attr(element, 'alt') === '') continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    const computed = accessibleName(element, document, { nameFromContent: false });
    if (computed.name !== '') {
      return { outcome: 'passed', message: `The image is named "${computed.name}".` };
    }
    if (computed.confidence === 'uncertain') {
      return {
        outcome: 'cantTell',
        message: `Marlo could not compute a reliable name. ${computed.reason ?? ''}`,
      };
    }
    return {
      outcome: 'failed',
      message:
        'The image has no accessible name, so a screen reader announces the filename or nothing ' +
        'at all. If the image is decorative, alt="" says so deliberately.',
    };
  },
});

/** c487ae: a link has a non-empty accessible name. */
export const linkHasName = nameRule({
  actId: 'c487ae',
  name: 'Link has non-empty accessible name',
  successCriteria: ['1.1.1', '2.4.4', '2.4.9', '4.1.2'],
  tags: ['a', 'area'],
  nameFromContent: true,
  applies: (element) => hasAttr(element, 'href'),
  subject: 'This link',
  consequence:
    'A screen reader announces "link" with no destination, which is unusable in a links list.',
});

/** 97a4e1: a button has a non-empty accessible name. */
export const buttonHasName = defineRule({
  actId: '97a4e1',
  name: 'Button has non-empty accessible name',
  successCriteria: ['4.1.2'],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, ['button', 'input', 'div', 'span', 'a'])) {
      if (isHiddenFromAssistiveTech(element)) continue;
      const role = explicitRole(element);
      const type = (attr(element, 'type') ?? '').toLowerCase();
      const isButton =
        element.tag === 'button' ||
        role === 'button' ||
        (element.tag === 'input' && ['button', 'submit', 'reset'].includes(type));
      // input type=image is 59796f's business, not this rule's.
      if (!isButton || (element.tag === 'input' && type === 'image')) continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    const computed = accessibleName(element, document, { nameFromContent: true });
    if (computed.name !== '') {
      return { outcome: 'passed', message: `The button is named "${computed.name}".` };
    }
    if (computed.confidence === 'uncertain') {
      return {
        outcome: 'cantTell',
        message: `Marlo could not compute a reliable name. ${computed.reason ?? ''}`,
      };
    }
    return {
      outcome: 'failed',
      message:
        'The button has no accessible name, so it is announced as "button" and nothing more.',
    };
  },
});

/** e086e5: a form field has a non-empty accessible name. */
export const formFieldHasName = defineRule({
  actId: 'e086e5',
  name: 'Form field has non-empty accessible name',
  successCriteria: ['1.3.1', '2.5.3', '4.1.2'],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, ['input', 'select', 'textarea'])) {
      if (isHiddenFromAssistiveTech(element)) continue;
      const type = (attr(element, 'type') ?? 'text').toLowerCase();
      // Hidden inputs are not in the tree; buttons and images are other rules'.
      if (['hidden', 'button', 'submit', 'reset', 'image'].includes(type)) continue;
      if (hasAttr(element, 'disabled')) continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    const computed = accessibleName(element, document, { nameFromContent: false });
    if (computed.name !== '') {
      return {
        outcome: 'passed',
        message: `The field is named "${computed.name}" via ${computed.from}.`,
      };
    }
    if (computed.confidence === 'uncertain') {
      return {
        outcome: 'cantTell',
        message: `Marlo could not compute a reliable name. ${computed.reason ?? ''}`,
      };
    }
    // Worth naming the specific near-miss, because it is the most common one and a
    // developer who used placeholder believes they labelled the field.
    const placeholder = attr(element, 'placeholder');
    const hint =
      placeholder !== null && normalise(placeholder) !== ''
        ? ` A placeholder ("${normalise(placeholder)}") is not a label: it disappears on focus and ` +
          'is not reliably announced.'
        : '';
    return {
      outcome: 'failed',
      message: `The field has no accessible name, so it is announced only by its type.${hint}`,
    };
  },
});

/** ffd0e9: a heading has a non-empty accessible name. */
export const headingHasName = defineRule({
  actId: 'ffd0e9',
  name: 'Heading has non-empty accessible name',
  successCriteria: [],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'div',
      'span',
      'p',
    ])) {
      if (isHiddenFromAssistiveTech(element)) continue;
      const native = /^h[1-6]$/.test(element.tag);
      const role = explicitRole(element);
      if (native && (role === 'presentation' || role === 'none')) continue;
      if (!native && role !== 'heading') continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    const computed = accessibleName(element, document, { nameFromContent: true });
    if (computed.name !== '') {
      return { outcome: 'passed', message: `The heading is named "${computed.name}".` };
    }
    if (computed.confidence === 'uncertain') {
      return {
        outcome: 'cantTell',
        message: `Marlo could not compute a reliable name. ${computed.reason ?? ''}`,
      };
    }
    return {
      outcome: 'failed',
      message:
        "The heading is empty. It still appears in a screen reader's heading list, as a blank " +
        'entry, which is worse than not being a heading at all.',
    };
  },
});

/** cae760: an iframe has a non-empty accessible name. */
export const iframeHasName = nameRule({
  actId: 'cae760',
  name: 'Iframe element has non-empty accessible name',
  successCriteria: ['4.1.2'],
  tags: ['iframe'],
  nameFromContent: false,
  subject: 'This iframe',
  consequence: 'A screen reader user moving between frames has nothing to distinguish this one by.',
});

/** 59796f: an image button has a non-empty accessible name. */
export const imageButtonHasName = defineRule({
  actId: '59796f',
  name: 'Image button has non-empty accessible name',
  successCriteria: ['1.1.1', '4.1.2'],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, ['input'])) {
      if (isHiddenFromAssistiveTech(element)) continue;
      if ((attr(element, 'type') ?? '').toLowerCase() !== 'image') continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    const computed = accessibleName(element, document, { nameFromContent: false });
    if (computed.name !== '') {
      return { outcome: 'passed', message: `The image button is named "${computed.name}".` };
    }
    return {
      outcome: 'failed',
      message:
        'An image button with no alt text is announced as "button" or as its filename. It is the ' +
        'submit control, so this usually blocks the form entirely.',
    };
  },
});

/** 8fc3b6: an object rendering non-text content has a non-empty accessible name. */
export const objectHasName = nameRule({
  actId: '8fc3b6',
  name: 'Object element rendering non-text content has non-empty accessible name',
  successCriteria: ['1.1.1'],
  tags: ['object'],
  nameFromContent: false,
  subject: 'This object element',
  consequence: 'Its content is opaque to assistive technology without a name.',
});

/** 7d6734: an svg with an explicit graphics role has a non-empty accessible name. */
export const svgHasName = defineRule({
  actId: '7d6734',
  name: 'SVG element with explicit role has non-empty accessible name',
  successCriteria: ['1.1.1'],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, ['svg'])) {
      if (isHiddenFromAssistiveTech(element)) continue;
      const role = (attr(element, 'role') ?? '').toLowerCase();
      // The ACT rule scopes to svg with an explicit img, graphics-document or
      // graphics-symbol role. An svg with no role is not in scope.
      if (!['img', 'graphics-document', 'graphics-symbol'].includes(role)) continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }, document) => {
    const computed = accessibleName(element, document, { nameFromContent: false });
    if (computed.name !== '') {
      return { outcome: 'passed', message: `The svg is named "${computed.name}".` };
    }
    // An svg can also be named by a child title element, which the generic computation
    // does not cover.
    const title = element.children.find((c) => c.tag === 'title');
    if (title !== undefined && normalise(title.text) !== '') {
      return {
        outcome: 'passed',
        message: `The svg is named "${normalise(title.text)}" by its title element.`,
      };
    }
    return {
      outcome: 'failed',
      message:
        'The svg declares a graphics role, so it is exposed as an image, and it has no accessible ' +
        'name. Either name it or drop the role.',
    };
  },
});

/** 2779a5: the page has a non-empty title. */
export const pageHasTitle = defineRule({
  actId: '2779a5',
  name: 'HTML page has non-empty title',
  successCriteria: ['2.4.2'],
  requires: ['dom'],
  fixability: 'never',
  applicability: (document) => {
    // Applies to the document, once. Scoped to HTML documents.
    const html = findAll(document, ['html'])[0];
    return html === undefined ? [] : [{ element: html }];
  },
  expectation: (_target, document) => {
    const titles = findAll(document, ['title']);
    // Only a title in head counts. A title inside an inline svg is not the page title,
    // which is a real distinction the ACT rule makes.
    const pageTitle = titles.find((t) => t.parent?.tag === 'head');
    if (pageTitle === undefined) {
      return {
        outcome: 'failed',
        message:
          'The page has no title element in its head. The title is the first thing a screen ' +
          'reader announces and the only label in a tab or a bookmark.',
      };
    }
    if (normalise(pageTitle.text) === '') {
      return {
        outcome: 'failed',
        message: 'The title element is empty, which is the same as having no title.',
      };
    }
    return { outcome: 'passed', message: `The page is titled "${normalise(pageTitle.text)}".` };
  },
});
