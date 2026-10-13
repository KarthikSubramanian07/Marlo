import { defineRule } from '../define.js';
import { walk } from '../dom.js';
import { formatColour } from '../colour.js';
import { contrastApplicability, measureContrast } from '../paint.js';

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
 * With layout present, the ratio comes from the paint-order walk in `paint.ts`: the
 * text colour composited over every background behind it, through any `opacity` on
 * the way up, against that same stack without the text. Where the walk cannot
 * conclude, because a background is an image or a gradient, a filter or blend mode
 * intervenes, a positioned element overlaps the text, or a colour is in a space Marlo
 * does not convert, the verdict is `cantTell` with the element named. A ratio from
 * declared colours alone was the one thing this file was never allowed to produce,
 * and it still is.
 *
 * Applicability is per element over its own text, so `<p>Hello <b>there</b></p>` is two
 * targets measured in their own styles. The exemptions are the ACT rule's: text with no
 * letters, hidden text, and text in or labelling a disabled widget. The vendored corpus
 * predates one change in the published rule: it exempted every widget, and the current
 * text exempts only disabled ones. Marlo follows the current text, which turns the two
 * widget examples from inapplicable into passed, an outcome the grading protocol allows.
 */

interface ContrastSpec {
  readonly actId: Parameters<typeof defineRule>[0]['actId'];
  readonly name: string;
  readonly criteria: readonly `${number}.${number}.${number}`[];
  /** Required ratio for text that is not large scale. */
  readonly regular: number;
  /** Required ratio for large scale text: 24px, or 18.66px at weight 700 or above. */
  readonly large: number;
}

function contrastRule(spec: ContrastSpec) {
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
      for (const element of walk(document.root)) {
        if (contrastApplicability(element, document).applicable) targets.push({ element });
      }
      return targets;
    },
    expectation: ({ element }, document) => {
      const measured = measureContrast(element, document);
      if (measured.kind === 'undecidable') return { outcome: 'cantTell', message: measured.reason };

      const threshold = measured.largeText ? spec.large : spec.regular;
      // Rounded to two decimals before the comparison, so the verdict and the number
      // the reader sees never disagree: a 4.4996 that prints as 4.50 passes.
      const ratio = Math.round(measured.ratio * 100) / 100;
      const size = `${measured.largeText ? 'large' : 'regular'} text at ${measured.fontSizePx}px, weight ${measured.fontWeight}`;
      const colours = `${formatColour(measured.foreground)} on ${formatColour(measured.background)}`;
      const notes = measured.notes.length === 0 ? '' : ` ${measured.notes.join(' ')}`;

      if (ratio < threshold) {
        return {
          outcome: 'failed',
          message:
            `This text is ${colours}, a contrast ratio of ${ratio.toFixed(2)}:1. It is ${size}, ` +
            `which needs at least ${threshold}:1.${notes}`,
        };
      }
      return {
        outcome: 'passed',
        message:
          `This text is ${colours}, a contrast ratio of ${ratio.toFixed(2)}:1, which meets the ` +
          `${threshold}:1 required for ${size}.${notes}`,
      };
    },
  });
}

export const minimumContrast = contrastRule({
  actId: 'afw4f7',
  name: 'Text has minimum contrast',
  criteria: ['1.4.3', '1.4.6'],
  regular: 4.5,
  large: 3,
});

export const enhancedContrast = contrastRule({
  actId: '09o5cg',
  name: 'Text has enhanced contrast',
  criteria: ['1.4.3', '1.4.6'],
  regular: 7,
  large: 4.5,
});
