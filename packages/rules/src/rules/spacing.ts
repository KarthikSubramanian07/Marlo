import { defineRule } from '../define.js';
import { ancestors, attr, isHiddenFromAssistiveTech, walk } from '../dom.js';
import type { MarloElement } from '../dom.js';

/**
 * The text-spacing rules, 1.4.12.
 *
 * All three ask the same question about a different property: does a `style` attribute
 * use `!important` to set a spacing value in a way that a user stylesheet cannot
 * override? The check is on the style attribute itself rather than on the computed
 * value, which is why these run under the static renderer: an inline `!important` is
 * visible in the DOM.
 *
 * That is narrower than the success criterion, which is about whether the user can
 * apply their own spacing at all. A stylesheet rule with `!important` would also fail
 * 1.4.12 and is invisible here. So a pass from these rules means "no inline
 * !important", not "the criterion is met", and the message says so.
 */

interface SpacingRule {
  readonly actId: Parameters<typeof defineRule>[0]['actId'];
  readonly name: string;
  readonly property: string;
  /** Minimum multiple of font size the criterion requires, where it applies. */
  readonly requirement: string;
  readonly threshold: number;
  /**
   * The multiple of font size `normal` (and therefore `initial`, whose specified value
   * *is* `normal` for all three of these properties) computes to. Exact for
   * letter-spacing and word-spacing, where the CSS Text spec defines `normal` as zero
   * additional spacing. Approximate for line-height, where the ACT rule's own examples
   * describe the used value as "generally around 1.2" rather than a fixed number, which
   * is still decisively below the 1.5 threshold either way.
   */
  readonly normalMultiple: number;
  /**
   * Whether a bare number or a percentage is a valid value for this property. Only
   * line-height accepts either, as a direct multiple of font size; letter-spacing and
   * word-spacing require a length unit, so a unitless number is not a value a browser
   * would apply.
   */
  readonly acceptsUnitlessMultiple: boolean;
}

/**
 * Positioned far enough off-screen that no reader ever sees the text, which is the
 * conventional idiom for visually-hidden content (`position: absolute; top: -999em`).
 * Not the same question as `isHiddenFromAssistiveTech`: off-screen text is still in the
 * accessibility tree, only not part of the visual presentation these rules are about.
 *
 * Deliberately narrow, matching this file's style attribute-only scope: a small offset
 * is ordinary positioning, so only a four-figure-or-larger magnitude counts, which is
 * the threshold the common `-999em` / `-9999px` idioms clear by a wide margin.
 */
function isOffScreen(element: MarloElement): boolean {
  for (const node of [element, ...ancestors(element)]) {
    const style = attr(node, 'style');
    if (style === null) continue;
    if (!/position\s*:\s*(?:absolute|fixed)\b/i.test(style)) continue;
    const offset = /(?:top|left|right|bottom)\s*:\s*(-?[\d.]+)/i.exec(style);
    if (offset === null) continue;
    if (Number.parseFloat(offset[1] ?? '0') <= -100) return true;
  }
  return false;
}

/**
 * Whether the text is set up so it can never take a soft wrap break, per line-height's
 * own applicability. Deliberately narrow: `white-space: nowrap`/`pre` is unambiguous,
 * and an inline `overflow-x: scroll` is the idiom for a fixed-width box that scrolls its
 * contents horizontally rather than wrapping them. Neither requires layout to read off
 * the style attribute, but this is not a general no-wrap detector: a stylesheet rule
 * doing the same thing is invisible here, same as everywhere else in this file.
 */
function cannotSoftWrap(element: MarloElement): boolean {
  for (const node of [element, ...ancestors(element)]) {
    const style = attr(node, 'style');
    if (style === null) continue;
    if (/white-space\s*:\s*(?:nowrap|pre)\b/i.test(style)) return true;
    if (/overflow-x\s*:\s*scroll\b/i.test(style)) return true;
  }
  return false;
}

function spacingRule(spec: SpacingRule) {
  return defineRule({
    actId: spec.actId,
    name: spec.name,
    successCriteria: ['1.4.12'],
    requires: ['dom'],
    fixability: 'auto',
    applicability: (document) => {
      const targets = [];
      for (const element of walk(document.root)) {
        const style = attr(element, 'style');
        if (style === null) continue;
        // Applies only where the property is set with !important in the style attribute.
        const pattern = new RegExp(`(?:^|;)\\s*${spec.property}\\s*:[^;]*!\\s*important`, 'i');
        if (!pattern.test(style)) continue;
        if (isHiddenFromAssistiveTech(element) || isOffScreen(element)) continue;
        if (spec.property === 'line-height' && cannotSoftWrap(element)) continue;
        targets.push({ element });
      }
      return targets;
    },
    expectation: ({ element }) => {
      const style = attr(element, 'style') ?? '';
      // Global, and the last match wins: two !important declarations for the same
      // property in one style attribute are equally important, so the cascade's
      // ordinary tiebreak applies and the later one is what a browser actually uses.
      const pattern = new RegExp(
        `(?:^|;)\\s*${spec.property}\\s*:\\s*([^;!]+)!\\s*important`,
        'gi',
      );
      let value = '';
      for (let match = pattern.exec(style); match !== null; match = pattern.exec(style)) {
        value = (match[1] ?? '').trim();
      }
      const lower = value.toLowerCase();

      const passes = (amount: number): boolean => amount >= spec.threshold;
      const passedResult = {
        outcome: 'passed' as const,
        message: `${spec.property}: ${value} !important already meets ${spec.requirement}.`,
      };
      const failedResult = {
        outcome: 'failed' as const,
        message:
          `${spec.property}: ${value} !important cannot be overridden by a user stylesheet, and ` +
          `it is below ${spec.requirement}. Removing !important is usually the whole fix.`,
      };

      // `inherit` and `unset` (which behaves as `inherit` for these inherited
      // properties) do not fix a value at all: the element defers to its ancestor, so
      // nothing in this style attribute restricts what the user can override there.
      if (lower === 'inherit' || lower === 'unset') {
        return {
          outcome: 'passed',
          message: `${spec.property}: ${value} !important defers to the inherited value, which this element's style attribute does not fix.`,
        };
      }

      // `initial` resolves to the property's own initial value, which is `normal` for
      // all three of these. Both are evaluated at the same number rather than exempted,
      // because that number is below the threshold for all three.
      if (lower === 'normal' || lower === 'initial') {
        return passes(spec.normalMultiple) ? passedResult : failedResult;
      }

      const percentage = spec.acceptsUnitlessMultiple ? /^([\d.]+)\s*%$/.exec(value) : null;
      if (percentage !== null) {
        return passes(Number.parseFloat(percentage[1] ?? '0') / 100) ? passedResult : failedResult;
      }

      const multiple = /^([\d.]+)\s*(em|rem)?$/i.exec(value);
      if (multiple !== null && (multiple[2] !== undefined || spec.acceptsUnitlessMultiple)) {
        return passes(Number.parseFloat(multiple[1] ?? '0')) ? passedResult : failedResult;
      }

      // A value in absolute units cannot be compared to a multiple of font size without
      // knowing the font size, which is a layout question.
      if (/\d\s*(px|pt|pc|cm|mm|in)$/i.test(value)) {
        return {
          outcome: 'cantTell',
          message:
            `${spec.property}: ${value} !important is in absolute units, so whether it meets ` +
            `${spec.requirement} depends on the resolved font size. Run with --renderer browser.`,
        };
      }

      return failedResult;
    },
  });
}

export const lineHeightNotImportant = spacingRule({
  actId: '78fd32',
  name: 'Important line height in style attributes is wide enough',
  property: 'line-height',
  requirement: '1.5 times the font size',
  threshold: 1.5,
  normalMultiple: 1.2,
  acceptsUnitlessMultiple: true,
});

export const letterSpacingNotImportant = spacingRule({
  actId: '24afc2',
  name: 'Important letter spacing in style attributes is wide enough',
  property: 'letter-spacing',
  requirement: '0.12 times the font size',
  threshold: 0.12,
  normalMultiple: 0,
  acceptsUnitlessMultiple: false,
});

export const wordSpacingNotImportant = spacingRule({
  actId: '9e45ec',
  name: 'Important word spacing in style attributes is wide enough',
  property: 'word-spacing',
  requirement: '0.16 times the font size',
  threshold: 0.16,
  normalMultiple: 0,
  acceptsUnitlessMultiple: false,
});
