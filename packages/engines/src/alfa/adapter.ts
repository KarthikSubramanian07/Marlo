import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { ActRuleId, Capability, EngineId, EngineReport, Outcome } from '@marlo/schema';
import type { RenderedPage } from '@marlo/render';
import { withDomGlobals } from '@marlo/render';
import { ensureScript, evaluateInPage, narrowHandle } from '../dom.js';
import { bundlePath, readBundle } from '../bundle.js';
import type { Engine, RawVerdict } from '../engine.js';
import { assembleReport, narrowCarriedTarget, truncateSnippet } from '../engine.js';
import { ALFA_MAPPING } from './mapping.js';
import { recordOutcome, type AlfaOutcomeRecord } from './outcome.js';

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
 * Alfa is imported dynamically on the window path for one reason: its own modules read
 * DOM globals at import time, so importing it before the window exists binds it to
 * nothing. On the browser path none of that applies. The same modules are bundled by
 * esbuild into `dist/alfa.browser.js`, injected into the page, and run against the real
 * document, where `globalThis.document` is simply the document. `browser-entry.ts` is
 * that bundle's entry and `outcome.ts` is the translation both paths share.
 */

const require = createRequire(import.meta.url);

let cachedVersion: string | null = null;
let cachedBundle: string | null = null;

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

/** Where the build puts the Alfa browser bundle. Works from `src` and from `dist`. */
export function alfaBundlePath(): string {
  return bundlePath(require.resolve('@marlo/engines/package.json'), 'alfa.browser.js');
}

function alfaBundleSource(): string {
  cachedBundle ??= readBundle(alfaBundlePath(), 'Alfa');
  return cachedBundle;
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

/** Audits a happy-dom window in this process. The original path. */
async function auditWindow(handle: unknown, pageUrl: string): Promise<AlfaOutcomeRecord[]> {
  return withDomGlobals(handle, async () => {
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

    const url = URL.parse(pageUrl).getUnsafe();
    const alfaPage = Page.of(Request.of('GET', url), Response.of(url, 200), document, device);

    const result = await Audit.of(alfaPage, rules).evaluate();
    // Collected inside the globals scope, because reading a lazy Alfa value after
    // the globals are gone throws. That includes the path and the serialisation.
    return [...result].map((outcome) => recordOutcome(outcome));
  });
}

/**
 * Narrows what came back across a serialisation boundary to the record shape.
 *
 * Here rather than in `outcome.ts`, because `outcome.ts` is bundled for the browser and
 * must import nothing at run time, and this half only ever runs in Node.
 *
 * A browser page hands back structured-cloned data, which is whatever the bundle put in
 * it. Checking the shape here means a bundle built from a different revision of this
 * module fails loudly rather than producing records with missing fields that read as
 * findings at `:root` with no evidence.
 */
export function narrowOutcomeRecords(value: unknown): readonly AlfaOutcomeRecord[] {
  if (!Array.isArray(value)) throw new TypeError('the Alfa audit did not return a list');
  return value.map((item: unknown, index): AlfaOutcomeRecord => {
    if (typeof item !== 'object' || item === null) {
      throw new TypeError(`Alfa outcome ${String(index)} is not an object`);
    }
    const ruleUri: unknown = Reflect.get(item, 'ruleUri');
    const message: unknown = Reflect.get(item, 'message');
    if (typeof ruleUri !== 'string') {
      throw new TypeError(`Alfa outcome ${String(index)} has no rule URI`);
    }
    return {
      outcome: Reflect.get(item, 'outcome'),
      ruleUri,
      ...narrowCarriedTarget(item),
      message: typeof message === 'string' ? message : null,
    };
  });
}

/**
 * Translates outcome records into verdicts, grouped by ACT rule.
 *
 * Shared by both paths. An outcome word this adapter does not know costs the rules that
 * outcome speaks for rather than the whole page: `narrowOutcome` throws by design, and
 * letting that reach the adapter's outer catch would mark every claimed rule errored
 * and discard verdicts already collected for rules that were fine.
 */
export function verdictsFromRecords(
  records: readonly AlfaOutcomeRecord[],
  mapping: typeof ALFA_MAPPING,
  actRuleIds: readonly ActRuleId[],
): { verdicts: Map<ActRuleId, RawVerdict[]>; errors: Map<ActRuleId, string> } {
  const verdicts = new Map<ActRuleId, RawVerdict[]>();
  const errors = new Map<ActRuleId, string>();

  for (const item of records) {
    // Alfa rule URIs look like https://alfa.siteimprove.com/rules/sia-r2.
    const engineRuleId = item.ruleUri.split('/').pop() ?? item.ruleUri;
    const mapped = mapping
      .engineToAct(engineRuleId)
      .filter((entry) => actRuleIds.includes(entry.actId));
    if (mapped.length === 0) continue;

    let outcome: Outcome;
    try {
      outcome = narrowOutcome(item.outcome, item.ruleUri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const entry of mapped) errors.set(entry.actId, message);
      continue;
    }

    for (const entry of mapped) {
      const list = verdicts.get(entry.actId) ?? [];
      list.push({
        engineRuleId,
        outcome,
        // Already `xpath ...` or `:root`; `outcome.ts` explains the notation.
        selector: item.selector,
        snippet: truncateSnippet(item.snippet),
        message: item.message ?? `Alfa ${engineRuleId}`,
      });
      verdicts.set(entry.actId, list);
    }
  }

  return { verdicts, errors };
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
    let verdicts = new Map<ActRuleId, RawVerdict[]>();
    let errors = new Map<ActRuleId, string>();

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
      // Narrowed before anything else, and loudly. Alfa reaches `globalThis.document`
      // through withDomGlobals rather than taking a window directly, so a handle it could
      // not read used to fail several frames deeper with "Cannot read properties of
      // undefined (reading 'createRange')", which tells a reader nothing. Found by the
      // first test that ever handed any adapter a Playwright page.
      const handle = narrowHandle(page.handle, 'alfa');
      let records: readonly AlfaOutcomeRecord[];

      if (handle.kind === 'window') {
        records = await auditWindow(handle.window, page.url);
      } else {
        await ensureScript(handle.page, 'MarloAlfa', alfaBundleSource);
        records = narrowOutcomeRecords(
          await evaluateInPage(handle.page, `return MarloAlfa.audit(${JSON.stringify(page.url)});`),
        );
      }

      ({ verdicts, errors } = verdictsFromRecords(records, this.mapping, actRuleIds));
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
