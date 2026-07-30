import { defineRule } from '../define.js';
import { attr, walk } from '../dom.js';

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
        targets.push({ element });
      }
      return targets;
    },
    expectation: ({ element }) => {
      const style = attr(element, 'style') ?? '';
      const declaration = new RegExp(
        `(?:^|;)\\s*${spec.property}\\s*:\\s*([^;!]+)!\\s*important`,
        'i',
      ).exec(style);
      const value = (declaration?.[1] ?? '').trim();

      // A `normal` or unitless-relative value large enough to satisfy the criterion is
      // permitted even with !important, which is the exception the ACT rules carry.
      if (/^normal$/i.test(value)) {
        return {
          outcome: 'passed',
          message: `${spec.property}: normal !important does not restrict the user's spacing.`,
        };
      }

      const multiple = /^([\d.]+)\s*(em|rem)?$/i.exec(value);
      if (multiple?.[2] !== undefined) {
        const amount = Number.parseFloat(multiple[1] ?? '0');
        const threshold =
          spec.property === 'line-height' ? 1.5 : spec.property === 'word-spacing' ? 0.16 : 0.12;
        if (amount >= threshold) {
          return {
            outcome: 'passed',
            message: `${spec.property}: ${value} !important already meets ${spec.requirement}.`,
          };
        }
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

      return {
        outcome: 'failed',
        message:
          `${spec.property}: ${value} !important cannot be overridden by a user stylesheet, and ` +
          `it is below ${spec.requirement}. Removing !important is usually the whole fix.`,
      };
    },
  });
}

export const lineHeightNotImportant = spacingRule({
  actId: '78fd32',
  name: 'Important line height in style attributes is wide enough',
  property: 'line-height',
  requirement: '1.5 times the font size',
});

export const letterSpacingNotImportant = spacingRule({
  actId: '24afc2',
  name: 'Important letter spacing in style attributes is wide enough',
  property: 'letter-spacing',
  requirement: '0.12 times the font size',
});

export const wordSpacingNotImportant = spacingRule({
  actId: '9e45ec',
  name: 'Important word spacing in style attributes is wide enough',
  property: 'word-spacing',
  requirement: '0.16 times the font size',
});
