/**
 * @marlo/engines
 *
 * Peer engine adapters, and the hand-written mapping from each engine's rule
 * identifiers to ACT rule identifiers.
 *
 * The mapping is the point of this package. No accessibility engine publishes one:
 * checked, not assumed, and recorded in RESEARCH.md §2. axe-core carries an `ACT` tag
 * on 85 of its 105 rules and no ACT identifiers anywhere. Alfa's rules carry WCAG
 * criteria, WCAG techniques and European Accessibility Act references, never an ACT
 * rule. HTML CodeSniffer carries WCAG technique codes.
 *
 * Two rules no adapter may break, both enforced by `assembleReport` rather than by
 * each adapter remembering:
 *
 *   Every requested rule appears in the output. A rule the engine does not implement
 *   comes back `unsupported`, not omitted. An omitted rule reads as a pass to
 *   anything counting results.
 *
 *   A rule that threw comes back `error`. Never a pass, and never folded into
 *   "found nothing".
 */

export type { Engine, EngineMapping, MappingEntry, MappingKind, RawVerdict } from './engine.js';
export { assembleReport, buildMapping, collapseOutcome, truncateSnippet } from './engine.js';
export type { DocumentLike, ElementLike, WindowLike } from './dom.js';
export { asWindow, describeSelector } from './dom.js';

export { AxeEngine } from './axe/adapter.js';
export { AXE_MAPPING } from './axe/mapping.js';
export { AlfaEngine } from './alfa/adapter.js';
export { ALFA_MAPPING } from './alfa/mapping.js';
export { HtmlcsEngine, normaliseCode } from './htmlcs/adapter.js';
export { HTMLCS_MAPPING } from './htmlcs/mapping.js';

import type { Engine } from './engine.js';
import { AxeEngine } from './axe/adapter.js';
import { AlfaEngine } from './alfa/adapter.js';
import { HtmlcsEngine } from './htmlcs/adapter.js';

/**
 * The peer engines, in the order the calibration table lists them.
 *
 * Marlo's own engine is deliberately absent: it lives in @marlo/rules, which cannot
 * import this package, so that its column in the table is produced without ever
 * observing a peer. DECISIONS.md D-008.
 */
export function peerEngines(): readonly Engine[] {
  return [new AxeEngine(), new AlfaEngine(), new HtmlcsEngine()];
}
