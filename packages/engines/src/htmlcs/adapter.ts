import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { ActRuleId, Capability, EngineId, EngineReport, Outcome } from '@trymarlo/schema';
import type { RenderedPage } from '@trymarlo/render';
import type { CarriedTarget, Engine, RawVerdict } from '../engine.js';
import { assembleReport, narrowCarriedTarget, truncateSnippet } from '../engine.js';
import { describeSelectorSource, ensureScript, evaluateInPage, narrowHandle } from '../dom.js';
import { HTMLCS_MAPPING } from './mapping.js';

/**
 * HTML CodeSniffer, Squiz Labs. BSD-3-Clause.
 *
 * The third opinion, and the one whose translation is least clean, which is worth
 * stating rather than smoothing over. Its results are `Error`, `Warning` and `Notice`,
 * and those are severities rather than ACT outcomes:
 *
 *   Error   -> failed. A definite violation.
 *   Warning -> cantTell. Something a human should look at, which is what cantTell
 *              means. Mapping it to `failed` would inflate recall by counting
 *              uncertainty as detection, and mapping it to `passed` would hide it.
 *   Notice  -> cantTell. Advisory, and in practice almost always "check this
 *              manually". Same reasoning.
 *
 * There is no equivalent of `passed` or `inapplicable`: HTML CodeSniffer reports only
 * what it wants to say something about. So a rule it says nothing about could be a
 * pass or could be out of scope, and the adapter reports `passed` for the rules it
 * claims and stayed silent on, which is the interpretation its own documentation
 * supports. That inference is the weakest link in this adapter and it is why several
 * of its mapping entries are marked `partial`.
 *
 * Last pushed January 2024. It is a peer rather than a dependency of the fix path, so
 * removing it would degrade the one-directional invariant rather than break the build.
 * Recorded as a carried risk in PLAN.md §6.
 */

const require = createRequire(import.meta.url);

let cachedSource: string | null = null;
let cachedVersion: string | null = null;

function htmlcsSource(): string {
  cachedSource ??= readFileSync(require.resolve('html_codesniffer/build/HTMLCS.js'), 'utf8');
  return cachedSource;
}

function htmlcsVersion(): string {
  cachedVersion ??= ((): string => {
    const pkg: unknown = JSON.parse(
      readFileSync(require.resolve('html_codesniffer/package.json'), 'utf8'),
    );
    if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
      const version: unknown = Reflect.get(pkg, 'version');
      if (typeof version === 'string') return version;
    }
    throw new Error('cannot read the html_codesniffer version');
  })();
  return cachedVersion;
}

/** HTML CodeSniffer's numeric message types. */
const OUTCOME_BY_TYPE: Readonly<Record<number, Outcome>> = Object.freeze({
  1: 'failed', // Error
  2: 'cantTell', // Warning
  3: 'cantTell', // Notice
});

/**
 * One HTML CodeSniffer message, with its evidence already read off the node.
 *
 * HTML CodeSniffer hands back the live DOM element in `element`, which is HONESTY.md
 * entry 3: the first version of this adapter typed it as a string and thirteen rules
 * threw at once. On the window path the node is still in this process and the snippet
 * is read here. On the browser path the node cannot leave the page, so the snippet and
 * the selector are read inside it and only this record crosses the boundary.
 */
export interface HtmlcsMessageRecord extends CarriedTarget {
  readonly type: number;
  readonly code: string;
  readonly msg: string;
}

/** At most this many messages are read off a page. HTML CodeSniffer emits one per element. */
const MESSAGE_LIMIT = 5_000;

/** Raw markup carried out of the page per message, before `truncateSnippet` trims it. */
const SNIPPET_CARRY_LIMIT = 1_000;

/** Reads an evidence snippet off whatever HTML CodeSniffer put in `element`. */
function snippetOf(element: unknown): string {
  if (typeof element === 'string') return element;
  if (typeof element !== 'object' || element === null) return '';
  const outer: unknown = Reflect.get(element, 'outerHTML');
  if (typeof outer === 'string') return outer;
  const tag: unknown = Reflect.get(element, 'tagName');
  return typeof tag === 'string' ? `<${tag.toLowerCase()}>` : '';
}

/** The window path's view of a live message list. */
function recordsFromLive(value: unknown): readonly HtmlcsMessageRecord[] {
  if (!Array.isArray(value)) throw new TypeError('HTMLCS.getMessages did not return an array');
  return (value as readonly { type: number; code: string; msg: string; element: unknown }[])
    .slice(0, MESSAGE_LIMIT)
    .map((message) => ({
      type: message.type,
      code: message.code,
      msg: message.msg,
      snippet: snippetOf(message.element),
      selector: ':root',
    }));
}

/**
 * Narrows what came back across the page boundary to message records.
 *
 * Field by field, because the page script and this file are two halves of one contract
 * and a drift between them should fail here rather than produce verdicts with an empty
 * code that match no mapping and read as silence.
 */
export function narrowRecords(value: unknown): readonly HtmlcsMessageRecord[] {
  if (!Array.isArray(value)) throw new TypeError('the page did not return a message list');
  return value.slice(0, MESSAGE_LIMIT).map((item: unknown, index): HtmlcsMessageRecord => {
    if (typeof item !== 'object' || item === null) {
      throw new TypeError(`HTML CodeSniffer message ${String(index)} is not an object`);
    }
    const type: unknown = Reflect.get(item, 'type');
    const code: unknown = Reflect.get(item, 'code');
    const msg: unknown = Reflect.get(item, 'msg');
    if (typeof type !== 'number' || typeof code !== 'string' || typeof msg !== 'string') {
      throw new TypeError(`HTML CodeSniffer message ${String(index)} is missing type, code or msg`);
    }
    return { type, code, msg, ...narrowCarriedTarget(item) };
  });
}

/**
 * The script that runs HTML CodeSniffer inside a browser page.
 *
 * Everything a verdict needs is read off the live element here, inside the page, and
 * only plain data is returned. The selector uses the same convention as the rest of
 * this package by carrying `describeSelector`'s own source across rather than a copy.
 */
function pageScript(): string {
  return (
    `const describe = ${describeSelectorSource()};\n` +
    "await new Promise((resolve) => { HTMLCS.process('WCAG2AA', document, resolve); });\n" +
    'const messages = HTMLCS.getMessages();\n' +
    'const records = [];\n' +
    'for (const message of messages) {\n' +
    `  if (records.length >= ${String(MESSAGE_LIMIT)}) break;\n` +
    '  const element = message.element;\n' +
    '  const isElement = typeof element === "object" && element !== null &&\n' +
    '    typeof element.tagName === "string" && typeof element.getAttribute === "function";\n' +
    '  const html = isElement && typeof element.outerHTML === "string" ? element.outerHTML\n' +
    '    : typeof element === "string" ? element : "";\n' +
    '  records.push({\n' +
    '    type: message.type,\n' +
    '    code: message.code,\n' +
    '    msg: message.msg,\n' +
    `    snippet: html.slice(0, ${String(SNIPPET_CARRY_LIMIT)}),\n` +
    '    selector: isElement ? describe(element) : ":root",\n' +
    '  });\n' +
    '}\n' +
    'return records;'
  );
}

/**
 * HTML CodeSniffer codes look like
 * `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37`. The last segment is the technique,
 * and technique plus criterion is what identifies the check.
 */
export function normaliseCode(code: string): string {
  const parts = code.split('.');
  if (parts.length < 5) return code;
  const criterion = parts[3] ?? '';
  const technique = parts.slice(4).join('.');
  return `${criterion}.${technique}`;
}

/**
 * Translates message records into verdicts for the claimed rules.
 *
 * One function for both paths, including the inference described at the top of this
 * file, made explicit rather than left implicit: a rule this engine claims and said
 * nothing about is reported as passed. It is the weakest step in this adapter and the
 * calibration table is where the cost of it shows up.
 */
export function verdictsFromRecords(
  records: readonly HtmlcsMessageRecord[],
  mapping: typeof HTMLCS_MAPPING,
  actRuleIds: readonly ActRuleId[],
  claimed: readonly ActRuleId[],
): Map<ActRuleId, RawVerdict[]> {
  const verdicts = new Map<ActRuleId, RawVerdict[]>();
  const spokenFor = new Set<ActRuleId>();

  for (const record of records) {
    const normalised = normaliseCode(record.code);
    for (const entry of mapping.engineToAct(normalised)) {
      if (!actRuleIds.includes(entry.actId)) continue;
      const outcome = OUTCOME_BY_TYPE[record.type];
      if (outcome === undefined) continue;
      spokenFor.add(entry.actId);
      const list = verdicts.get(entry.actId) ?? [];
      list.push({
        engineRuleId: normalised,
        outcome,
        selector: record.selector,
        snippet: truncateSnippet(record.snippet),
        message: record.msg,
      });
      verdicts.set(entry.actId, list);
    }
  }

  for (const actId of claimed) {
    if (spokenFor.has(actId)) continue;
    verdicts.set(actId, [
      {
        engineRuleId: mapping.actToEngine(actId)[0]?.engineRuleId ?? 'unknown',
        outcome: 'passed',
        selector: ':root',
        snippet: '',
        message:
          'HTML CodeSniffer reported nothing for this check. It emits only what it has ' +
          'something to say about, so silence is read as a pass.',
      },
    ]);
  }

  return verdicts;
}

export class HtmlcsEngine implements Engine {
  readonly id: EngineId = 'htmlcs';
  readonly requires: readonly Capability[] = ['dom'];
  readonly mapping = HTMLCS_MAPPING;

  get version(): string {
    return htmlcsVersion();
  }

  async evaluate(page: RenderedPage, actRuleIds: readonly ActRuleId[]): Promise<EngineReport> {
    const started = Date.now();
    let verdicts = new Map<ActRuleId, RawVerdict[]>();
    const errors = new Map<ActRuleId, string>();

    const claimed = actRuleIds.filter((id) => this.mapping.claimedRules.has(id));

    if (claimed.length > 0) {
      try {
        const handle = narrowHandle(page.handle, 'html_codesniffer');
        let records: readonly HtmlcsMessageRecord[];

        if (handle.kind === 'window') {
          handle.window.eval(htmlcsSource());
          const raw: unknown = await Promise.resolve(
            handle.window.eval(
              `new Promise((resolve) => {
                 HTMLCS.process('WCAG2AA', document, function () { resolve(HTMLCS.getMessages()); });
               })`,
            ) as Promise<unknown>,
          );
          records = recordsFromLive(raw);
        } else {
          await ensureScript(handle.page, 'HTMLCS', htmlcsSource);
          records = narrowRecords(await evaluateInPage(handle.page, pageScript()));
        }

        verdicts = verdictsFromRecords(records, this.mapping, actRuleIds, claimed);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const actId of claimed) errors.set(actId, message);
      }
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
