import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { ActRuleId, Capability, EngineId, EngineReport, Outcome } from '@marlo/schema';
import type { RenderedPage } from '@marlo/render';
import { withDomGlobals } from '@marlo/render';
import { asWindow } from '../dom.js';
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
  /** Alfa's path to the target, `/html[1]/body[1]/p[2]`, or null for a document-level one. */
  readonly path: string | null;
  /** The target serialised by Alfa, which for an element is its markup. */
  readonly snippet: string;
  /** What Alfa's expectation said, or null when it said nothing a reader could use. */
  readonly message: string | null;
}

/**
 * Reads the evidence off an Alfa target.
 *
 * Alfa targets are its own node objects, not selectors, and the first version of this
 * adapter reported `:root` for every finding rather than fabricate a selector. Alfa
 * does give a path, `/html[1]/head[1]/meta[3]`, and a serialisation, and both are read
 * through `Reflect` because they arrive typed as the union of every Alfa node kind. A
 * text-node target has a path and its text; a document-level target has neither, and
 * `:root` remains the honest answer for that one.
 */
function readTarget(target: unknown): { path: string | null; snippet: string } {
  if (typeof target !== 'object' || target === null) return { path: null, snippet: '' };
  let path: string | null = null;
  const pathFn: unknown = Reflect.get(target, 'path');
  if (typeof pathFn === 'function') {
    const value: unknown = Reflect.apply(pathFn, target, []);
    if (typeof value === 'string' && value !== '') path = value;
  }
  // Every object inherits `Object.prototype.toString`, so a `typeof` check on it and a
  // `typeof` check on its result are both vacuous: they pass for anything and hand back
  // "[object Object]". That string was reaching the snippet field, which is the evidence
  // a reader is shown for the finding. Only an override counts, and a result still
  // shaped like the default is refused.
  let snippet = '';
  const serialise: unknown = Reflect.get(target, 'toString');
  if (typeof serialise === 'function' && serialise !== Object.prototype.toString) {
    const value: unknown = Reflect.apply(serialise, target, []);
    if (typeof value === 'string' && !/^\[object \w+\]$/.test(value)) snippet = value;
  }
  return { path, snippet };
}

/**
 * What Alfa's expectations said, in its words.
 *
 * `toJSON()` on an outcome carries an `expectations` list of `[id, result]` pairs, and
 * a result holds its diagnostic under `error` when it failed and under `value` when it
 * passed. Both are read, so a passed verdict explains itself too. Anything that is not
 * shaped like that yields null, and the caller falls back to naming the rule.
 */
function readMessage(outcome: object): string | null {
  const toJSON: unknown = Reflect.get(outcome, 'toJSON');
  if (typeof toJSON !== 'function') return null;
  const json: unknown = Reflect.apply(toJSON, outcome, []);
  if (typeof json !== 'object' || json === null) return null;
  const expectations: unknown = Reflect.get(json, 'expectations');
  if (!Array.isArray(expectations)) return null;

  // A failed outcome carries the expectations it satisfied alongside the one it did
  // not. Reading all of them put the satisfied ones first, so the evidence for a
  // failure opened by saying the element passed something. Alfa's own `Failed.toSARIF`
  // filters to the erring results and this mirrors it, which also means the two
  // renderings of one outcome cannot disagree about which clause failed.
  const failed = Reflect.get(json, 'outcome') === 'failed';
  const messages: string[] = [];
  for (const entry of expectations as unknown[]) {
    if (!Array.isArray(entry)) continue;
    const result: unknown = entry[1];
    if (typeof result !== 'object' || result === null) continue;
    if (failed && Reflect.get(result, 'type') !== 'err') continue;
    const inner: unknown = Reflect.get(result, 'error') ?? Reflect.get(result, 'value');
    const holder = typeof inner === 'object' && inner !== null ? inner : result;
    const message: unknown = Reflect.get(holder, 'message');
    if (typeof message === 'string' && message.trim() !== '') {
      messages.push(message.replace(/\s+/g, ' ').trim());
    }
  }
  // Several clauses of one rule, kept apart, because a bare space ran them together
  // into a sentence Alfa never wrote.
  return messages.length === 0 ? null : messages.join('; ');
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
      // The same guard the axe-core and HTML CodeSniffer adapters use, and this one did not.
      //
      // Alfa reaches `globalThis.document` through withDomGlobals rather than taking a window
      // directly, so a handle it cannot read did not fail here: it failed several frames deeper
      // with "Cannot read properties of undefined (reading 'createRange')", which tells a reader
      // nothing about what went wrong or what to do.
      //
      // Found by the first test that ever handed any adapter a Playwright page. Two of the three
      // peers explained themselves and this one did not.
      asWindow(page.handle, 'alfa');

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
        // the globals are gone throws. That includes the path and the serialisation.
        return [...result].map((o): AlfaOutcome => {
          const outcome = o as unknown as {
            outcome: unknown;
            rule: { uri: string };
            target: unknown;
          };
          const { path, snippet } = readTarget(outcome.target);
          return {
            outcome: outcome.outcome,
            rule: { uri: outcome.rule.uri },
            path,
            snippet,
            message: readMessage(o),
          };
        });
      });

      for (const item of outcomes) {
        // Alfa rule URIs look like https://alfa.siteimprove.com/rules/sia-r2.
        const engineRuleId = item.rule.uri.split('/').pop() ?? item.rule.uri;
        const mapped = this.mapping
          .engineToAct(engineRuleId)
          .filter((entry) => actRuleIds.includes(entry.actId));
        if (mapped.length === 0) continue;

        // Narrowed once per outcome, and inside its own catch, so an outcome word this
        // adapter does not know costs the rules that outcome speaks for rather than the
        // whole page. `narrowOutcome` throws by design, and the outer catch marks every
        // rule the engine claims as errored, which would discard verdicts already
        // collected for rules that were fine.
        let outcome;
        try {
          outcome = narrowOutcome(item.outcome, item.rule.uri);
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
            // Alfa locates by an XPath-shaped path rather than a CSS selector, and
            // this field carries a CSS selector for every other engine. Reported
            // with its notation named, because `/html[1]/body[1]/p[2]` on its own
            // reads as a selector to a person and as an absolute file path to
            // anything consuming the report: `sarif.ts` uses this field as the
            // artifact URI when a finding has no source mapping. `:root` stays for
            // a document-level target, which is the one case it is true of.
            selector: item.path === null ? ':root' : `xpath ${item.path}`,
            snippet: truncateSnippet(item.snippet),
            message: item.message ?? `Alfa ${engineRuleId}`,
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
