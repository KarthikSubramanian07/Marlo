import { defineRule } from '../define.js';
import { findAll, isHiddenFromAssistiveTech, normalise } from '../dom.js';

/**
 * The contrast rules. Detected and located, never auto-fixed, per the product spec:
 * recolouring is a design decision, and Marlo choosing a colour would be exactly the
 * "fix drifting into redesign" failure the LLM accessibility literature catalogues.
 *
 * Both declare `layout` and `paint`, which the static renderer does not provide, so
 * under the default renderer they report `unsupported` rather than a verdict. That is
 * the capability model doing its job: reporting "contrast was not examined" instead of
 * "no contrast problems were found".
 *
 * axe reached the same conclusion independently. Running it over all 19 of afw4f7's
 * official test cases under happy-dom produced `incomplete` on every one and `failed`
 * on none, because the colours cannot be resolved without layout. Two engines declining
 * for the same reason is a better argument for the capability model than either one
 * alone.
 *
 * Under the browser renderer these still return `cantTell` rather than a computed
 * ratio: a correct implementation needs the effective background behind any
 * transparency, which is a paint-order walk this pass does not implement. Locating the
 * text and naming the declared colours is real value, and asserting a ratio Marlo has
 * not correctly computed would not be.
 */

const TEXT_TAGS = [
  'p',
  'span',
  'a',
  'li',
  'td',
  'th',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'label',
  'button',
  'strong',
  'em',
  'div',
  'figcaption',
  'caption',
  'legend',
  'dt',
  'dd',
  'blockquote',
  'cite',
  'code',
  'small',
  'summary',
];

function contrastRule(spec: {
  actId: Parameters<typeof defineRule>[0]['actId'];
  name: string;
  criteria: readonly `${number}.${number}.${number}`[];
  ratio: string;
}) {
  return defineRule({
    actId: spec.actId,
    name: spec.name,
    successCriteria: [...spec.criteria],
    // Declared honestly. The static renderer provides neither, so the capability model
    // refuses the rule before it can produce a number that does not describe what a
    // user sees.
    requires: ['dom', 'layout', 'paint'],
    fixability: 'never',
    applicability: (document) => {
      const targets = [];
      for (const element of findAll(document, TEXT_TAGS)) {
        if (isHiddenFromAssistiveTech(element)) continue;
        // Only elements with their own text, not containers of other text elements.
        const ownText = element.children.length === 0 ? element.text : '';
        if (normalise(ownText) === '') continue;
        targets.push({ element });
      }
      return targets;
    },
    expectation: ({ element }) => {
      const colour = element.computed?.get('color');
      const background = element.computed?.get('background-color');

      if (colour === null || colour === undefined) {
        return {
          outcome: 'cantTell',
          message:
            'No resolved colour is available for this text, so the contrast ratio cannot be ' +
            'computed.',
        };
      }

      return {
        outcome: 'cantTell',
        message:
          `This text is ${colour} on ${background ?? 'an unresolved background'}. Marlo locates ` +
          `text for the ${spec.ratio} requirement but does not compute the ratio: doing it ` +
          'correctly needs the effective background behind any transparency, which is a paint ' +
          'order walk this version does not implement. Asserting a ratio Marlo has not computed ' +
          'correctly would be worse than declining.',
      };
    },
  });
}

export const minimumContrast = contrastRule({
  actId: 'afw4f7',
  name: 'Text has minimum contrast',
  criteria: ['1.4.3', '1.4.6'],
  ratio: '4.5 to 1',
});

export const enhancedContrast = contrastRule({
  actId: '09o5cg',
  name: 'Text has enhanced contrast',
  criteria: ['1.4.3', '1.4.6'],
  ratio: '7 to 1',
});
