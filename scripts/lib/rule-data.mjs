/**
 * Pattern definitions for check-claims.mjs and check-prose.mjs.
 *
 * WHY THIS FILE EXISTS SEPARATELY
 *
 * A checker that scans the repository for a phrase cannot scan the file that
 * defines the phrase. The first version of check-claims.mjs failed on its own
 * source, three times, because the word it forbids has to appear in the pattern
 * that forbids it.
 *
 * The wrong fixes, both considered and rejected:
 *
 *   An inline suppression comment. That is an escape hatch on the whole check,
 *   and the first phrase anyone reaches for it with is exactly the phrase that
 *   should not ship.
 *
 *   Excluding the checker scripts entirely. That leaves the checker logic
 *   unscanned as well, and the logic is where an explanation could hide a claim
 *   in a comment nobody reads.
 *
 * So the data is here, alone, and this is the only file either checker skips.
 * The checker logic itself is scanned normally. This file contains no prose
 * other than the comment you are reading and the `reason` strings, which exist
 * to be printed at a developer who just tripped the check.
 *
 * The protection against this exception growing is not discipline. It is
 * scripts/lib/rule-data.test.mjs, which asserts the skip list is exactly this
 * one path. Adding a second file to it fails the build.
 *
 * Dash patterns use escapes rather than literal characters, so those two rules
 * would be self-clean even without the exclusion.
 */

/** The one path both checkers skip. Asserted by rule-data.test.mjs. */
export const SELF = 'scripts/lib/rule-data.mjs';

/**
 * Claims Marlo may not make, with the reason each is refused. The reason is
 * printed on failure, because a check that only says "forbidden" teaches nobody
 * anything.
 */
export const FORBIDDEN_CLAIMS = [
  {
    id: 'wcag-certified',
    pattern: /\bwcag[\s-]*certified\b/gi,
    reason: 'No body issues WCAG conformance certificates. There is nothing to be certified by.',
  },
  {
    id: 'certified',
    pattern: /\bcertified\b/gi,
    reason:
      'Marlo provides automated analysis and verified repair, not legal certification. ' +
      'Nobody is empowered to issue that certificate.',
  },
  {
    id: 'guaranteed-compliance',
    pattern: /\bguarantee(?:d|s)?\s+(?:wcag\s+)?compliance?\b|\bguaranteed\s+compliant\b/gi,
    reason: 'Automation reaches a minority of WCAG criteria. A guarantee would be a lie.',
  },
  {
    id: 'fully-accessible',
    pattern: /\bfully\s+(?:accessible|compliant|conformant)\b/gi,
    reason:
      'A tool cannot establish full accessibility. Publish the fraction with its denominator.',
  },
  {
    id: 'perfect-score',
    pattern: /\b100\s*%\s*(?:compliant|accessible|conformant|conformance|coverage)\b/gi,
    reason:
      'The sibling PDF project printed exactly this while producing documents no validator ' +
      'would accept. See its docs/honesty.md.',
  },
  {
    id: 'eliminates-risk',
    pattern: /\beliminates?\s+(?:ada\s+|legal\s+|litigation\s+)?risk\b/gi,
    reason: 'Marlo reduces specific measurable defects. It does not eliminate legal exposure.',
  },
  {
    id: 'zero-risk',
    pattern: /\bzero\s+(?:legal|ada|litigation)\s+risk\b/gi,
    reason: 'The same claim phrased the other way round.',
  },
  {
    id: 'lawsuit-proof',
    pattern: /\blawsuit[\s-]*proof\b|\bada[\s-]*proof\b/gi,
    reason: 'Overlay vendor language. A regulator has already intervened over claims like this.',
  },
  {
    id: 'comprehensive-coverage',
    pattern: /\bcomprehensive\s+(?:wcag|accessibility)\s+(?:coverage|testing|compliance)\b/gi,
    reason:
      'Marlo is not comprehensive and says so. Coverage is a fraction with a visible denominator.',
  },
];

/** Writing rules. */
export const PROSE_RULES = [
  {
    id: 'em-dash',
    // — rather than the character, so this rule is self-clean.
    pattern: /—/g,
    message: 'Em dash. Use a colon, a comma, parentheses, or a full stop.',
  },
  {
    id: 'horizontal-bar',
    pattern: /―/g,
    message: 'Horizontal bar, which is an em dash wearing a hat.',
  },
  {
    id: 'slop-vocabulary',
    pattern: new RegExp(
      '\\b(?:' +
        [
          'delve',
          'delving',
          'leverage[sd]?',
          'leveraging',
          'seamless(?:ly)?',
          'robust suite',
          'unlock(?:s|ing)? (?:the |your )?(?:power|potential|value)',
          'game[\\s-]?chang(?:er|ing)',
          'revolutioni[sz]e[sd]?',
          'cutting[\\s-]edge',
          'state[\\s-]of[\\s-]the[\\s-]art',
          'best[\\s-]in[\\s-]class',
          'effortless(?:ly)?',
          'supercharge[sd]?',
          'elevate your',
          'dive deep',
          'deep dive',
          "in today's (?:fast[\\s-]paced |digital )?world",
          'at the end of the day',
          'it goes without saying',
          'needless to say',
        ].join('|') +
        ')\\b',
      'gi',
    ),
    message: 'Slop vocabulary. Say the specific thing instead.',
  },
  {
    id: 'not-just-x-but-y',
    pattern:
      /\b(?:it|this|that|marlo|we)(?:'s| is| are|'re)? not (?:just|only|merely|simply)\b[^.!?\n]{0,90}?(?:,|—|;)\s*(?:it|this|that|they)(?:'s| is| are|'re)\b/gi,
    message: 'The "not just X, it is Y" construction. Delete the first half, state the second.',
  },
  {
    id: 'empty-intensifier',
    pattern:
      /\b(?:truly|really|very|extremely|incredibly) (?:powerful|simple|easy|fast|robust)\b/gi,
    message: 'Intensifier plus vague adjective. Give the number or the mechanism.',
  },
];

/**
 * Files whose bytes are somebody else's. The corpus is vendored under the W3C
 * Software and Document Licence and is digest-verified, so it cannot be used as
 * a hiding place. The lockfile has no prose. LICENSE and CODE_OF_CONDUCT are
 * boilerplate nobody may edit.
 */
export const NOT_OUR_PROSE = [
  /^corpus\//,
  /^pnpm-lock\.yaml$/,
  /^LICENSE$/,
  /^CODE_OF_CONDUCT\.md$/,
];

/** Same, for claims. The Code of Conduct is ours to the extent of adopting it. */
export const NOT_OUR_CLAIMS = [/^corpus\//, /^pnpm-lock\.yaml$/, /^LICENSE$/];
