import type { ActRuleId, Capability, EngineReport, RendererId } from '@trymarlo/schema';
import { buildDocument, evaluateRules, type Box, type SourceElement } from '@trymarlo/rules';

/**
 * The entry point of the Marlo rules browser bundle.
 *
 * Bundled by esbuild as part of this package's `build` script into
 * `dist/marlo.browser.js`, as an immediately invoked script exposing `MarloRules`.
 * `MarloEngine` injects that file into a Playwright page and calls
 * `MarloRules.evaluate(actRuleIds, options)`, which returns the finished `EngineReport`
 * as plain JSON.
 *
 * @trymarlo/rules is pure, so the bundle is the rules plus this file. What this file adds is
 * the two things only a laid-out page can supply and that `ParseOptions` otherwise takes
 * as null: resolved styles from the real `getComputedStyle`, and each element's border
 * box in document coordinates. Resolving styles for every element at build time is
 * acceptable here because a scan is not a hot path, and it is what makes the layout
 * rules evaluated rather than `unsupported`.
 *
 * It lives here rather than in @trymarlo/rules because this is where `MarloEngine` lives,
 * and because a browser entry is a packaging concern, not a rule.
 */

/** The parts of a live element this file reads beyond what `SourceElement` declares. */
interface LiveElement extends SourceElement {
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
}

interface LiveStyle {
  getPropertyValue(property: string): string;
}

/** The browser globals this file reaches for, typed structurally so no DOM lib is needed. */
interface BrowserGlobals {
  readonly document: {
    readonly documentElement: LiveElement | null;
    readonly doctype: unknown;
  };
  getComputedStyle(element: unknown): LiveStyle;
  readonly scrollX: number;
  readonly scrollY: number;
}

export interface EvaluateInPageOptions {
  readonly url: string;
  readonly renderer: RendererId;
  readonly capabilities: readonly Capability[];
  readonly version: string;
}

/** Evaluates Marlo's rules against the current document. */
export function evaluate(
  actRuleIds: readonly ActRuleId[],
  options: EvaluateInPageOptions,
): EngineReport {
  const globals = globalThis as unknown as BrowserGlobals;
  const root = globals.document.documentElement;
  if (root === null) throw new Error('MarloRules.evaluate found a document with no root');

  const document = buildDocument(root, {
    url: options.url,
    hasDoctype: globals.document.doctype !== null && globals.document.doctype !== undefined,
    computedStyleFor: (element) => {
      const style = globals.getComputedStyle(element);
      return { get: (property) => style.getPropertyValue(property) };
    },
    boxFor: (element): Box => {
      const rect = (element as LiveElement).getBoundingClientRect();
      // Offset by the scroll position so the box is in document coordinates, which is
      // what the `Box` contract promises: scrolling does not move it.
      return {
        x: rect.x + globals.scrollX,
        y: rect.y + globals.scrollY,
        width: rect.width,
        height: rect.height,
      };
    },
  });

  return evaluateRules(actRuleIds, {
    document,
    renderer: options.renderer,
    capabilities: new Set(options.capabilities),
    version: options.version,
  });
}
