import type { MappingEntry } from '../engine.js';
import { buildMapping } from '../engine.js';

/**
 * Alfa rule ids (`sia-rNN`) to ACT rule ids.
 *
 * Alfa's own metadata carries WCAG success criteria, WCAG techniques and European
 * Accessibility Act references, and never an ACT rule identifier. Verified: of 89
 * exported rules, 76 have non-criterion requirements and every one of those is a
 * technique or an EAA reference. So this table is hand-written like the others.
 *
 * BUILT FROM A DISCOVERY RUN OVER THE WHOLE CORPUS, THE SAME WAY THE AXE TABLE WAS.
 *
 * `node scripts/discover-mappings.mjs --engine alfa` runs every Alfa rule over all
 * 1134 test cases through the same StaticRenderer the harness uses and reports, per
 * ACT rule, which Alfa rules fired on its failing examples and which fired on its
 * passing or inapplicable ones. The first version of this file predates that support
 * and was written from Alfa's rule descriptions; #43 measured those entries one at a
 * time, and the discovery run then found twenty more rules the descriptions had not
 * suggested, including implementations of the four ACT rules that had been routed to
 * no engine at all. Every entry below cites its counts as `f<caught>/<failing>
 * p<passing flagged> i<inapplicable flagged>`, with `ct<n>` where Alfa answered
 * cantTell, and names the specific case behind any miss or false positive.
 *
 * A correlation is a proposal, not a mapping. Each rule added from the run was read in
 * `node_modules/.pnpm/@siteimprove+alfa-rules@0.119.0/node_modules/@siteimprove/alfa-rules/dist/sia-rNN/rule.js`
 * to confirm its applicability and expectation are the ACT rule's condition, because
 * four Alfa rules (R1, R4, R59, R87: title, lang, headings, focus) fire on nearly every
 * corpus fragment and correlate with everything while meaning none of it.
 *
 * What is below started as the subset where Alfa's own published rule descriptions
 * state the same condition as the ACT rule in the same words, a documentation match
 * rather than a measurement, and every entry was `partial` on that basis alone. #43
 * asked whether that held up: run each rule over the corpus and see whether the
 * correspondence is what the note claims. Fourteen entries came back clean (every
 * failing example caught, nothing else flagged) and are `exact`, cited `f<n>/<n> p<n>
 * i<n>` in the note the way discover-mappings.mjs and the axe table do. Two catch every
 * failing example but also flag a passing one and are `superset`, with the specific
 * false positive named. Two are genuinely `partial`, confirmed rather than assumed,
 * with the specific miss named. Every remaining entry below has now been run through
 * this; none still reads as a bare documentation match.
 *
 * THREE ENTRIES ARE GONE RATHER THAN RECLASSIFIED, AND THE ABSENCE IS THE FINDING.
 *
 * All three returned `inapplicable` on every one of their rule's failing corpus
 * examples, which read at first as a weak `partial`. It was not: reading the installed
 * `@siteimprove/alfa-rules@0.119.0` source showed each entry named the wrong thing.
 *
 *   sia-r3   -> 3ea0c8  Does not exist. The rule was retired at some version between
 *                       whenever this line was written and 0.119.0; the ids currently
 *                       exported skip r3 along with r34, r36, r51, r52, r58, r82, r83,
 *                       r88 and r89. axe-core still claims 3ea0c8 on its own, so the ACT
 *                       rule is not left uncovered, only this entry is wrong.
 *   sia-r28  -> 8fc3b6  sia-r28's applicability filters on `hasInputType('image')`: it
 *                       checks `<input type="image">` accessible names, not `<object>`.
 *                       It cannot ever fire on 8fc3b6's corpus, which is all `<object>`.
 *                       The condition it does check is likely 59796f ("Image button has
 *                       non-empty accessible name"), currently unclaimed by any engine,
 *                       but that is a lead for the next measurement, not a claim made
 *                       here.
 *   sia-r33  -> bc4a75  sia-r33's applicability is `video(document, device, { audio: {
 *                       has: false } })`: it checks silent video for a transcript
 *                       (WCAG G159), not required owned ARIA elements. bc4a75's corpus
 *                       is `role="list"` and similar, which sia-r33 never inspects. The
 *                       likely correct target is one of the transcript rules (ee13b5 is
 *                       the closest reading of "visual-only content"), unclaimed here
 *                       for the same reason.
 *
 * Both were reachable by reading the rule source, `node_modules/.pnpm/@siteimprove+alfa-
 * rules@0.119.0/node_modules/@siteimprove/alfa-rules/dist/sia-r28/rule.js` (and sia-r33
 * alongside it), not by guessing from the corpus results. A `partial` label on either
 * would have been another documentation match: plausible from the ACT rule's title,
 * wrong about what the code evaluates, and exactly the kind of confident wrong answer
 * #43 exists to catch.
 *
 * Alfa earns its place in the table regardless of how complete this file is, because
 * its outcome vocabulary is `passed | failed | cantTell | inapplicable`, which is
 * ACT's exactly. Its column carries no translation error, which no other peer can say.
 */
const ENTRIES: readonly MappingEntry[] = [
  {
    engineRuleId: 'sia-r1',
    actId: '2779a5',
    kind: 'exact',
    note: 'f5/5 p0 i0. Alfa R1 checks that the document has a non-empty title, exactly the ACT rule, clean on every corpus example.',
  },
  {
    engineRuleId: 'sia-r2',
    actId: '23a2a8',
    kind: 'exact',
    note: 'f5/5 p0 i0. Alfa R2 checks images have an accessible name, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r4',
    actId: 'b5c3f8',
    kind: 'exact',
    note: 'f4/4 p0 i0. Alfa R4 checks the html element has a lang attribute, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r5',
    actId: 'bf051a',
    kind: 'exact',
    note: 'f4/4 p0 i0. Alfa R5 checks the page lang attribute has a valid primary language subtag, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r7',
    actId: 'de46e4',
    kind: 'exact',
    note: 'f9/9 p0 i0. Alfa R7 checks lang attributes on elements other than html, exactly the ACT rule, the largest clean correspondence in this table.',
  },
  {
    engineRuleId: 'sia-r8',
    actId: 'e086e5',
    kind: 'exact',
    note: 'f7/7 p0 i0. Alfa R8 checks form fields have an accessible name, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r11',
    actId: 'c487ae',
    kind: 'exact',
    note: 'f11/11 p0 i0. Alfa R11 checks links have an accessible name, exactly the ACT rule, on the largest sample in this table.',
  },
  {
    engineRuleId: 'sia-r12',
    actId: '97a4e1',
    kind: 'exact',
    note: 'f5/5 p0 i0. Alfa R12 checks buttons have an accessible name, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r13',
    actId: 'cae760',
    kind: 'partial',
    note: 'f3/4 p0 i0. Alfa R13 checks iframes have an accessible name, and catches three of four failing corpus examples. Misses cae760/38cee2a5 (an `<iframe title=" " role="none">`): a whitespace-only title is not a name, but Alfa reads role="none" as taking the element out of scope and returns inapplicable rather than failed, where the ACT rule still requires the name.',
  },
  {
    engineRuleId: 'sia-r16',
    actId: '4e8ab6',
    kind: 'exact',
    note: 'f2/2 p0 i0. Alfa R16 checks elements with a role have its required states and properties, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r17',
    actId: '6cfa84',
    kind: 'superset',
    note: 'f6/6 p1 i0. Alfa R17 flags any focusable descendant of an aria-hidden element, but ACT 6cfa84 only requires the descendant to be invisible. False positive on corpus case 6cfa84/4cfb71f ("Passed Example 4"), an off-screen focus sentinel used to trap focus in a modal, which the ACT rule permits and Alfa flags.',
  },
  {
    engineRuleId: 'sia-r18',
    actId: '5c01ea',
    kind: 'exact',
    note: 'f2/2 p0 i0. Alfa R18 checks ARIA states and properties are permitted on the element, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r19',
    actId: '6a7281',
    kind: 'exact',
    note: 'f10/10 p0 i0. Alfa R19 checks ARIA state and property values are valid, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r20',
    actId: '5f99a7',
    kind: 'exact',
    note: 'f2/2 p0 i0. Alfa R20 checks aria- attributes are defined in WAI-ARIA, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r110',
    actId: '674b10',
    kind: 'exact',
    note: 'f2/2 p0 i0. Alfa R110 checks that a role attribute resolves to a valid role, applying the ARIA fallback so `role="searchfield searchbox"` is valid because its second token is. It replaces R21 here: R21 flagged any invalid token and produced a false positive on 674b10/22ce45f8 ("Passed Example 3", that exact attribute), which the ACT rule passes. Alfa deprecated R21 in favour of R110 for the same reason, and mapping the deprecated rule was measuring Alfa at its worst rather than as shipped.',
  },
  {
    engineRuleId: 'sia-r43',
    actId: '7d6734',
    kind: 'exact',
    note: 'f4/4 p0 i0. Alfa R43 checks SVG elements with an explicit role have an accessible name, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r64',
    actId: 'ffd0e9',
    kind: 'exact',
    note: 'f8/8 p0 i0. Alfa R64 checks headings have an accessible name, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r69',
    actId: 'afw4f7',
    kind: 'partial',
    note: 'f5/8 p1 i0 ct4. Alfa R69 checks text has sufficient contrast. Needs layout, so expect cantTell on the static renderer, the same as axe, which accounts for most of the shortfall. Also one false positive: afw4f7/0b212e48 ("Passed Example 7") is a decorative divider string of symbols on a low-contrast background, which the ACT rule exempts as non-meaningful text and Alfa flags anyway, so the gap is not layout alone.',
  },
  {
    engineRuleId: 'sia-r9',
    actId: 'bc659a',
    kind: 'exact',
    note: 'f4/4 p0 i0. Alfa R9 checks a meta refresh either has no delay or a delay above twenty hours, which is the ACT rule with its exception. Passes the 72001-second example the no-exception rule fails.',
  },
  {
    engineRuleId: 'sia-r96',
    actId: 'bisz58',
    kind: 'exact',
    note: 'f4/4 p0 i0. Alfa R96 is the no-exception variant of R9: any delayed meta refresh fails, including one above twenty hours, which is exactly bisz58. R9 alone catches three of four here because it honours the exception bisz58 does not.',
  },
  {
    engineRuleId: 'sia-r94',
    actId: 'm6b1q3',
    kind: 'exact',
    note: 'f2/2 p0 i0. Alfa R94 checks an element with role menuitem has a non-empty accessible name. Before this entry no engine measured well enough to be routed this rule; axe maps it through button-name at 0.67 precision.',
  },
  {
    engineRuleId: 'sia-r68',
    actId: 'bc4a75',
    kind: 'partial',
    note: 'f6/7 p0 i0. Alfa R68 checks an element with a role that requires owned elements has them (hasRequiredChildren). Misses bc4a75/a7a314ce ("Failed Example 7"): a menu whose nested group owns treeitems rather than menuitems, two levels down, which the ACT rule fails and Alfa does not report.',
  },
  {
    engineRuleId: 'sia-r42',
    actId: 'ff89c9',
    kind: 'partial',
    note: 'f3/4 p0 i0. Alfa R42 checks an element whose role requires a context role is owned by one (hasRequiredParent). Misses ff89c9/289c7bc0 ("Failed Example 4"): listitems inside a shadow root, referenced by aria-owns from a list outside it, which the ACT rule fails and Alfa does not report.',
  },
  {
    engineRuleId: 'sia-r46',
    actId: 'd0f69e',
    kind: 'partial',
    note: 'f2/3 p0 i0. Alfa R46 checks each header cell in a table element has at least one cell assigned to it. Misses d0f69e/46645a39 ("Failed Example 3"), an ARIA grid built from divs with role="columnheader": R46 walks table elements only, and the ACT rule applies to the grid role as well.',
  },
  {
    engineRuleId: 'sia-r45',
    actId: 'a25f45',
    kind: 'superset',
    note: 'f4/4 p0 i0. Alfa R45 checks that every id in a headers attribute refers to a cell in the same table, which is the ACT rule, and carries a second expectation the ACT rule does not: it also fails a cell whose headers attribute refers to itself (HeadersRefersToSelf). Nothing in this corpus exercises that, which is why the measurement is clean and the kind is not exact. Its first expectation is also a cardinality proxy, `cells.size === ids.size`, rather than a per-token resolution. Not R77, which asks the reverse question of whether a data cell has a header and only correlates by accident.',
  },
  {
    engineRuleId: 'sia-r86',
    actId: '46ca7f',
    kind: 'partial',
    note: 'f2/3 p0 i0. Alfa R86 checks that an element marked decorative is not included in the accessibility tree. Marked decorative is `isMarkedDecorative`, which is broader than a role attribute: it covers role none or presentation on anything, and also an `img` carrying `alt=""` with no role at all. Misses 46ca7f/baa8fcdc ("Failed Example 3"), an svg with role="none" and an aria-label: the ACT rule holds that the global aria-label keeps the element exposed, and Alfa does not flag it. The alt-based branch is img-only, so it does not rescue that svg. R67 is the same expectation restricted to img and svg, so it catches a subset of what R86 catches and adds nothing.',
  },
  {
    engineRuleId: 'sia-r90',
    actId: '307n5z',
    kind: 'partial',
    note: 'f3/3 p0 i0. Alfa R90 checks that an element whose role has presentational children contains no descendant that is *tabbable*, and ACT 307n5z is about content that is *focusable*. Those differ: a descendant with tabindex="-1" is focusable and not tabbable, so the ACT rule fails it and R90 passes it. The corpus contains no example of that shape, which is why the measurement is clean, and a clean measurement over a corpus that never asks the question is not equivalence.',
  },
  {
    engineRuleId: 'sia-r28',
    actId: '59796f',
    kind: 'exact',
    note: 'f3/3 p0 i0. Alfa R28 checks an input of type image has a non-empty accessible name, exactly the ACT rule. This was the lead left when the same rule was removed from 8fc3b6, where it had been mapped by its description and could never fire; measured here rather than assumed.',
  },
  {
    engineRuleId: 'sia-r10',
    actId: '73f2c2',
    kind: 'exact',
    note: 'f5/5 p0 i0. Alfa R10 checks an autocomplete attribute on a form field has a valid token sequence, exactly the ACT rule, including the applicability exclusions for hidden and disabled fields and for the values on and off.',
  },
  {
    engineRuleId: 'sia-r63',
    actId: '8fc3b6',
    kind: 'exact',
    note: 'f4/4 p0 i0. Alfa R63 checks an object element that embeds media has a non-empty accessible name, exactly the ACT rule. This is the rule that should have been here instead of R28.',
  },
  {
    engineRuleId: 'sia-r47',
    actId: 'b4f0c3',
    kind: 'exact',
    note: 'f4/4 p0 i0. Alfa R47 checks a meta viewport does not prevent zoom through user-scalable=no or a maximum-scale below 2, exactly the ACT rule.',
  },
  {
    engineRuleId: 'sia-r44',
    actId: 'b33eff',
    kind: 'exact',
    note: 'f3/3 p0 i0. Alfa R44 resolves the cascade under both orientations and fails a transform that locks rotation, exactly the ACT rule. Works on the static renderer because Alfa evaluates style elements itself; no other engine here claims the rule.',
  },
  {
    engineRuleId: 'sia-r91',
    actId: '24afc2',
    kind: 'superset',
    note: 'f3/4 p0 i1. Alfa R91 is its implementation of the letter-spacing rule and shares its threshold. Fires on 24afc2/f57bef41 ("Inapplicable Example 3"), text positioned off-screen with top: -999em, which the ACT rule excludes as not visible and Alfa cannot see as off-screen without a viewport. Misses 24afc2/0d7c8aa0 ("Failed Example 3"), letter-spacing: normal !important.',
  },
  {
    engineRuleId: 'sia-r92',
    actId: '9e45ec',
    kind: 'superset',
    note: 'f3/4 p0 i1. Alfa R92 is its implementation of the word-spacing rule. Same shape as R91: fires on the off-screen inapplicable example 9e45ec/4b55d76e and misses 9e45ec/673f8527 ("Failed Example 3"), word-spacing: normal !important.',
  },
  {
    engineRuleId: 'sia-r93',
    actId: '78fd32',
    kind: 'superset',
    note: 'f6/6 p0 i1. Alfa R93 is its implementation of the line-height rule and catches every failing example. Fires on 78fd32/166eef55 ("Inapplicable Example 4"), the off-screen text, for the same reason as R91.',
  },
  {
    engineRuleId: 'sia-r66',
    actId: '09o5cg',
    kind: 'partial',
    note: 'f7/10 p1 i0 ct3. Alfa R66 checks text has enhanced contrast of 7:1, computed from declared colours where it can and cantTell where a background image or gradient makes the ratio unknowable. One false positive, 09o5cg/c83b77f0 ("Passed Example 6"), a decorative string of symbols the ACT rule exempts as non-meaningful text, the same shape as R69 on the minimum-contrast rule.',
  },
  {
    engineRuleId: 'sia-r15',
    actId: '4b1c6c',
    kind: 'partial',
    note: 'f0/4 p0 i0 ct10. Alfa R15 groups iframes by identical accessible name and asks a human whether they embed the same resource, so every applicable example is cantTell. The condition is the ACT rule exactly and the answer is never automatic, which the strict view records as zero recall and the official view as consistent; the flattered column exists for this row. No other engine claims the rule.',
  },
  {
    engineRuleId: 'sia-r41',
    actId: 'b20e66',
    kind: 'partial',
    note: 'f0/6 p0 i0 ct14. Alfa R41 groups links by identical accessible name and asks whether they serve the same purpose. cantTell on every applicable example, for the same reason as R15, and no other engine claims the rule.',
  },
  {
    engineRuleId: 'sia-r81',
    actId: 'fd3a94',
    kind: 'partial',
    note: 'f0/5 p0 i0 ct12. Alfa R81 is R41 restricted to links in the same context, which is the distinction between fd3a94 and b20e66. cantTell on every applicable example.',
  },
  {
    engineRuleId: 'sia-r39',
    actId: '9eb3f6',
    kind: 'partial',
    note: 'f0/5 p0 i0 ct8. Alfa R39 finds an image whose accessible name equals its filename and asks whether that is acceptable. cantTell on every applicable example, which is also what Marlo answers for this rule and for the same reason: whether a filename describes an image is a judgment.',
  },
];

export const ALFA_MAPPING = buildMapping(ENTRIES);
