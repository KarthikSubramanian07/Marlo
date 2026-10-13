import type { CarriedTarget } from '../engine.js';

/**
 * Reads an Alfa outcome into plain data.
 *
 * Pure, and imported from two places that must agree: the Node adapter, which audits a
 * happy-dom window, and the browser bundle entry, which audits the real document inside a
 * Playwright page. One translation, so the two renderers cannot disagree about what an
 * Alfa outcome says before the calibration harness ever compares them.
 *
 * Nothing in here touches Alfa's types. Every value arrives as `unknown` and is read
 * through `Reflect`, because an outcome's target is typed as the union of every Alfa node
 * kind, and because this module has to be bundled for a browser without dragging Alfa's
 * declarations along.
 */

/**
 * An Alfa outcome, flattened to what crosses a serialisation boundary unchanged.
 *
 * The target half is the package-wide `CarriedTarget`. Alfa locates by an XPath-shaped
 * path rather than a CSS selector, and the selector field carries a CSS selector for every
 * other engine, so the path is reported with its notation named: `/html[1]/body[1]/p[2]`
 * on its own reads as a selector to a person and as an absolute file path to anything
 * consuming the report, and `sarif.ts` uses this field as the artifact URI when a finding
 * has no source mapping. `:root` stays for a document-level target, which is the one case
 * it is true of.
 */
export interface AlfaOutcomeRecord extends CarriedTarget {
  /** Alfa's own outcome word. Narrowed to ACT's four by the adapter, never here. */
  readonly outcome: unknown;
  /** The rule URI, `https://alfa.siteimprove.com/rules/sia-r2`. */
  readonly ruleUri: string;
  /** What Alfa's expectation said, or null when it said nothing a reader could use. */
  readonly message: string | null;
}

/** The selector field for an Alfa path, with its notation named. */
export function selectorForPath(path: string | null): string {
  return path === null ? ':root' : `xpath ${path}`;
}

/**
 * Reads the evidence off a single Alfa target.
 *
 * Alfa targets are its own node objects, not selectors, and the first version of the
 * adapter reported `:root` for every finding rather than fabricate a selector. Alfa does
 * give a path, `/html[1]/head[1]/meta[3]`, and a serialisation, and both are read through
 * `Reflect` because they arrive typed as the union of every Alfa node kind. A text-node
 * target has a path and its text; a document-level target has neither, and `:root`
 * remains the honest answer for that one.
 */
export function readOneTarget(target: unknown): { path: string | null; snippet: string } {
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

/** At most this many members of a group are read, because a page sets the count. */
export const GROUP_MEMBER_LIMIT = 10;

/**
 * The evidence for one Alfa target.
 *
 * Most targets are Alfa DOM nodes, and the base `Node` declares both `path` and a real
 * `toString`, so those give a genuine locator and genuine markup.
 *
 * A `Group` does not. It is what the multi-element rules report, R41 and R81 among
 * them, and it declares neither: it is a plain wrapper over its members with a
 * `Symbol.iterator`. Read as a single target it produced "[object Object]" at `:root`,
 * which is the whole evidence for a finding about links that share an accessible name,
 * on a page where those links are the entire point. Alfa handles the case itself, and
 * `Group.toSARIF` flat-maps the members' locations, so this reads the members too: the
 * first member that has one supplies the locator, and their serialisations are joined
 * for the snippet. Bounded, because how many members a group has is a property of the
 * page rather than of this adapter.
 */
export function readTarget(target: unknown): { path: string | null; snippet: string } {
  if (typeof target !== 'object' || target === null) return { path: null, snippet: '' };

  // Alfa's DOM nodes are iterable too, over their children, so being iterable is not what
  // makes a group. A node declares `path` and a group does not: reading an element's
  // children here moved every element locator onto its first text node.
  const ownPath: unknown = Reflect.get(target, 'path');
  const iterate: unknown = Reflect.get(target, Symbol.iterator);
  if (typeof ownPath !== 'function' && typeof iterate === 'function') {
    const members: unknown[] = [];
    try {
      for (const member of target as Iterable<unknown>) {
        members.push(member);
        if (members.length === GROUP_MEMBER_LIMIT) break;
      }
    } catch {
      // An iterable that throws part way through still yields what it produced.
    }
    if (members.length > 0) {
      const read = members.map((member) => readOneTarget(member));
      return {
        path: read.find((r) => r.path !== null)?.path ?? null,
        snippet: read
          .map((r) => r.snippet)
          .filter((s) => s !== '')
          .join(' '),
      };
    }
  }

  return readOneTarget(target);
}

/**
 * What Alfa's expectations said, in its words.
 *
 * `toJSON()` on an outcome carries an `expectations` list of `[id, result]` pairs, and
 * a result holds its diagnostic under `error` when it failed and under `value` when it
 * passed. Both are read, so a passed verdict explains itself too. Anything that is not
 * shaped like that yields null, and the caller falls back to naming the rule.
 */
export function readMessage(outcome: object): string | null {
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

/**
 * Flattens one Alfa outcome to a record of plain values.
 *
 * Called while the outcome is still readable: in Node that means inside the
 * `withDomGlobals` scope, because reading a lazy Alfa value after the globals are gone
 * throws, and in the browser it means inside the page before the result is returned.
 */
export function recordOutcome(outcome: unknown): AlfaOutcomeRecord {
  const o = outcome as { outcome: unknown; rule: { uri: string }; target: unknown };
  const { path, snippet } = readTarget(o.target);
  return {
    outcome: o.outcome,
    ruleUri: o.rule.uri,
    selector: selectorForPath(path),
    snippet,
    message: typeof outcome === 'object' && outcome !== null ? readMessage(outcome) : null,
  };
}
