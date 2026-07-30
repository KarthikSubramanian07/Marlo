import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { ActRuleId, Capability, EngineId, EngineReport, Outcome } from '@marlo/schema';
import type { RenderedPage } from '@marlo/render';
import { withDomGlobals } from '@marlo/render';
import type { Engine, RawVerdict } from '../engine.js';
import { assembleReport, truncateSnippet } from '../engine.js';
import { ALFA_MAPPING } from './mapping.js';

/**
 * Alfa, Siteimprove's engine. MIT.
 *
 * The most valuable peer, for a reason that is not obvious: its outcome vocabulary is
 * `passed | failed | cantTell | inapplicable`, which is ACT's vocabulary exactly. axe
 * has `violations | passes | incomplete | inapplicable`, which maps onto it but not
 * precisely, and HTML CodeSniffer has `Error | Warning | Notice`, which does not map
 * cleanly at all. Alfa needs no translation, so its column in the calibration table
 * carries no translation error.
 *
 * Getting it running took four attempts and the shape is not guessable, so it is
 * written down. `Native.fromNode` reads `globalThis.document` and calls `createRange`
 * on it; it does not accept a document for that part, so the window has to be global
 * while it runs, which is what `withDomGlobals` is for. The serialised result then has
 * to be hydrated with `Node.from(json, device)`. `Document.fromDocument` looks like the
 * right function and returns a Trampoline, which produces
 * "node.children is not a function" several frames later.
 *
 * Alfa is imported dynamically for one reason: its own modules read DOM globals at
 * import time, so importing it before the window exists binds it to nothing.
 */

const require = createRequire(import.meta.url);

let cachedVersion: string | null = null;

function alfaVersion(): string {
  cachedVersion ??= ((): string => {
    const pkg: unknown = JSON.parse(
      readFileSync(require.resolve('@siteimprove/alfa-rules/package.json'), 'utf8'),
    );
    if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
      const version: unknown = Reflect.get(pkg, 'version');
      if (typeof version === 'string') return version;
    }
    throw new Error('cannot read the @siteimprove/alfa-rules version');
  })();
  return cachedVersion;
}

/**
 * Alfa's outcomes already use ACT's words, so this is an identity map with a guard.
 * The guard matters: a future Alfa that introduced a fifth outcome would otherwise
 * have it silently coerced, and a coerced outcome in the calibration table is a wrong
 * number with no symptom.
 */
function narrowOutcome(value: unknown, ruleUri: string): Outcome {
  if (
    value === 'passed' ||
    value === 'failed' ||
    value === 'cantTell' ||
    value === 'inapplicable'
  ) {
    return value;
  }
  throw new TypeError(
    `Alfa returned outcome "${String(value)}" for ${ruleUri}, which is not one of ACT's four. ` +
      'Coercing it would put a wrong number in the calibration table with no symptom.',
  );
}

/** The parts of an Alfa outcome this adapter reads. */
interface AlfaOutcome {
  readonly outcome: unknown;
  readonly rule: { readonly uri: string };
  target?: unknown;
}

export class AlfaEngine implements Engine {
  readonly id: EngineId = 'alfa';
  readonly requires: readonly Capability[] = ['dom'];
  readonly mapping = ALFA_MAPPING;

  get version(): string {
    return alfaVersion();
  }

  async evaluate(page: RenderedPage, actRuleIds: readonly ActRuleId[]): Promise<EngineReport> {
    const started = Date.now();
    const verdicts = new Map<ActRuleId, RawVerdict[]>();
    const errors = new Map<ActRuleId, string>();

    const claimed = actRuleIds.filter((id) => this.mapping.claimedRules.has(id));
    if (claimed.length === 0) {
      return assembleReport({
        engine: this.id,
        engineVersion: this.version,
        page,
        requested: actRuleIds,
        requires: this.requires,
        mapping: this.mapping,
        verdicts,
        durationMs: Date.now() - started,
      });
    }

    try {
      const outcomes = await withDomGlobals(page.handle, async () => {
        // Every one of these has to be imported after the globals are installed.
        const { Native } = await import('@siteimprove/alfa-dom/native');
        const { Node } = await import('@siteimprove/alfa-dom');
        const { Page } = await import('@siteimprove/alfa-web');
        const { Request, Response } = await import('@siteimprove/alfa-http');
        const { Device } = await import('@siteimprove/alfa-device');
        const { Audit } = await import('@siteimprove/alfa-act');
        const { URL } = await import('@siteimprove/alfa-url');
        const rules = (await import('@siteimprove/alfa-rules')).default;

        const device = Device.standard();
        const serialised = await Native.fromNode(Reflect.get(globalThis, 'document') as never);
        // Node.from, not Document.fromDocument. The latter returns a Trampoline and
        // fails later with "node.children is not a function".
        //
        // Node.from is typed as returning the union of every Alfa node type, and
        // Page.of wants a Document. The cast is narrowing a runtime fact the types
        // cannot express: the input to Native.fromNode was a document, so the output
        // is a document. Asserted by the adapter test, which would throw on the Page
        // construction if it were not.
        const document = Node.from(serialised, device) as never;

        const url = URL.parse(page.url).getUnsafe();
        const alfaPage = Page.of(Request.of('GET', url), Response.of(url, 200), document, device);

        const result = await Audit.of(alfaPage, rules).evaluate();
        // Collected inside the globals scope, because reading a lazy Alfa value after
        // the globals are gone throws.
        return [...result].map((o): AlfaOutcome => {
          const outcome = o as unknown as AlfaOutcome;
          return { outcome: outcome.outcome, rule: { uri: outcome.rule.uri }, target: undefined };
        });
      });

      for (const item of outcomes) {
        // Alfa rule URIs look like https://alfa.siteimprove.com/rules/sia-r2.
        const engineRuleId = item.rule.uri.split('/').pop() ?? item.rule.uri;
        for (const entry of this.mapping.engineToAct(engineRuleId)) {
          if (!actRuleIds.includes(entry.actId)) continue;
          const list = verdicts.get(entry.actId) ?? [];
          list.push({
            engineRuleId,
            outcome: narrowOutcome(item.outcome, item.rule.uri),
            // Alfa targets are its own node objects rather than selectors. Reporting
            // the rule scope honestly is better than fabricating a selector that a
            // reader would try to paste into a console.
            selector: ':root',
            snippet: truncateSnippet(''),
            message: `Alfa ${engineRuleId}`,
          });
          verdicts.set(entry.actId, list);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const actId of claimed) errors.set(actId, message);
    }

    return assembleReport({
      engine: this.id,
      engineVersion: this.version,
      page,
      requested: actRuleIds,
      requires: this.requires,
      mapping: this.mapping,
      verdicts,
      errors,
      durationMs: Date.now() - started,
    });
  }
}
