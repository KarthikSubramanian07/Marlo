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
 * SMALLER AND MORE CAUTIOUS THAN THE AXE TABLE, ON PURPOSE.
 *
 * The axe mapping was derived by running axe over all 1134 test cases and reviewing
 * the correlations. Alfa cannot go through the same script, because its modules read
 * DOM globals at import time and have to be loaded inside `withDomGlobals`, so its
 * discovery runs through the calibration harness instead. That work is filed rather
 * than guessed at here.
 *
 * What is below started as the subset where Alfa's own published rule descriptions
 * state the same condition as the ACT rule in the same words, a documentation match
 * rather than a measurement, and every entry was `partial` on that basis alone. #43
 * asked whether that held up: run each rule over the corpus and see whether the
 * correspondence is what the note claims. Fourteen entries came back clean (every
 * failing example caught, nothing else flagged) and are `exact`, cited `f<n>/<n> p<n>
 * i<n>` in the note the way discover-mappings.mjs and the axe table do. Two catch every
 * failing example but also flag a passing one and are `superset`, with the specific
 * false positive named. Three return `inapplicable` on every one of their rule's
 * failing examples rather than catching any of them, which is not what a `partial`
 * claims either, so their notes carry the same citation as an open question rather than
 * a resolved one. The rest have not been run through this yet, and their notes still
 * read as a documentation match.
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
    engineRuleId: 'sia-r3',
    actId: '3ea0c8',
    kind: 'partial',
    note: "f0/3 p0 i0. Alfa R3 checks id uniqueness. Worth having because axe removed its general duplicate-id rule, so Alfa may be the only engine covering this, but it returned inapplicable on all three of this rule's failing corpus examples rather than catching any of them, which #43 leaves as an open question rather than a settled partial.",
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
    note: 'Alfa R13 checks iframes have an accessible name.',
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
    engineRuleId: 'sia-r21',
    actId: '674b10',
    kind: 'superset',
    note: 'f2/2 p1 i0. Alfa R21 flags a role attribute if any of its space-separated tokens is invalid, but ACT 674b10 accepts the attribute once one token resolves to a valid role, per the ARIA role-list fallback. False positive on corpus case 674b10/22ce45f ("Passed Example 3", `role="searchfield searchbox"`), where "searchbox" is valid and the ACT rule passes, but Alfa flags it over the unrecognised "searchfield" token.',
  },
  {
    engineRuleId: 'sia-r28',
    actId: '8fc3b6',
    kind: 'partial',
    note: "f0/4 p0 i0. Alfa R28 checks object elements have an accessible name, but it returned inapplicable on all four of this rule's failing corpus examples rather than catching any of them, which #43 leaves as an open question rather than a settled partial.",
  },
  {
    engineRuleId: 'sia-r33',
    actId: 'bc4a75',
    kind: 'partial',
    note: "f0/7 p0 i0. Alfa R33 checks required owned elements are present, but it returned inapplicable on all seven of this rule's failing corpus examples rather than catching any of them, which #43 leaves as an open question rather than a settled partial.",
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
    note: 'Alfa R69 checks text has sufficient contrast. Needs layout, so expect cantTell on the static renderer, the same as axe.',
  },
];

export const ALFA_MAPPING = buildMapping(ENTRIES);
