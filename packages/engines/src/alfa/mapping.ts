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
 * What is below is the subset where Alfa's own published rule descriptions state the
 * same condition as the ACT rule in the same words, which is a documentation match
 * rather than a measurement. Every entry is therefore marked `partial` unless the
 * harness has confirmed it, and the calibration table is what will confirm or
 * contradict each one. An entry the corpus contradicts fails the mapping test.
 *
 * Alfa earns its place in the table regardless of how complete this file is, because
 * its outcome vocabulary is `passed | failed | cantTell | inapplicable`, which is
 * ACT's exactly. Its column carries no translation error, which no other peer can say.
 */
const ENTRIES: readonly MappingEntry[] = [
  {
    engineRuleId: 'sia-r1',
    actId: '2779a5',
    kind: 'partial',
    note: 'Alfa R1 checks that the document has a non-empty title, which is the same condition. Documentation match, not yet measured.',
  },
  {
    engineRuleId: 'sia-r2',
    actId: '23a2a8',
    kind: 'partial',
    note: 'Alfa R2 checks images have an accessible name. Documentation match.',
  },
  {
    engineRuleId: 'sia-r3',
    actId: '3ea0c8',
    kind: 'partial',
    note: 'Alfa R3 checks id uniqueness. Worth having because axe removed its general duplicate-id rule, so Alfa may be the only engine covering this.',
  },
  {
    engineRuleId: 'sia-r4',
    actId: 'b5c3f8',
    kind: 'partial',
    note: 'Alfa R4 checks the html element has a lang attribute.',
  },
  {
    engineRuleId: 'sia-r5',
    actId: 'bf051a',
    kind: 'partial',
    note: 'Alfa R5 checks the page lang attribute has a valid primary language subtag.',
  },
  {
    engineRuleId: 'sia-r7',
    actId: 'de46e4',
    kind: 'partial',
    note: 'Alfa R7 checks lang attributes on elements other than html.',
  },
  {
    engineRuleId: 'sia-r8',
    actId: 'e086e5',
    kind: 'partial',
    note: 'Alfa R8 checks form fields have an accessible name.',
  },
  {
    engineRuleId: 'sia-r11',
    actId: 'c487ae',
    kind: 'partial',
    note: 'Alfa R11 checks links have an accessible name.',
  },
  {
    engineRuleId: 'sia-r12',
    actId: '97a4e1',
    kind: 'partial',
    note: 'Alfa R12 checks buttons have an accessible name.',
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
    kind: 'partial',
    note: 'Alfa R16 checks elements with a role have its required states and properties.',
  },
  {
    engineRuleId: 'sia-r17',
    actId: '6cfa84',
    kind: 'partial',
    note: 'Alfa R17 checks aria-hidden elements contain no focusable content.',
  },
  {
    engineRuleId: 'sia-r18',
    actId: '5c01ea',
    kind: 'partial',
    note: 'Alfa R18 checks ARIA states and properties are permitted on the element.',
  },
  {
    engineRuleId: 'sia-r19',
    actId: '6a7281',
    kind: 'partial',
    note: 'Alfa R19 checks ARIA state and property values are valid.',
  },
  {
    engineRuleId: 'sia-r20',
    actId: '5f99a7',
    kind: 'partial',
    note: 'Alfa R20 checks aria- attributes are defined in WAI-ARIA.',
  },
  {
    engineRuleId: 'sia-r21',
    actId: '674b10',
    kind: 'partial',
    note: 'Alfa R21 checks role attribute values are valid.',
  },
  {
    engineRuleId: 'sia-r28',
    actId: '8fc3b6',
    kind: 'partial',
    note: 'Alfa R28 checks object elements have an accessible name.',
  },
  {
    engineRuleId: 'sia-r33',
    actId: 'bc4a75',
    kind: 'partial',
    note: 'Alfa R33 checks required owned elements are present.',
  },
  {
    engineRuleId: 'sia-r43',
    actId: '7d6734',
    kind: 'partial',
    note: 'Alfa R43 checks SVG elements with an explicit role have an accessible name.',
  },
  {
    engineRuleId: 'sia-r64',
    actId: 'ffd0e9',
    kind: 'partial',
    note: 'Alfa R64 checks headings have an accessible name.',
  },
  {
    engineRuleId: 'sia-r69',
    actId: 'afw4f7',
    kind: 'partial',
    note: 'Alfa R69 checks text has sufficient contrast. Needs layout, so expect cantTell on the static renderer, the same as axe.',
  },
];

export const ALFA_MAPPING = buildMapping(ENTRIES);
