import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { ActRuleId, Capability, EngineId, EngineReport, Outcome } from '@marlo/schema';
import type { RenderedPage } from '@marlo/render';
import type { Engine, RawVerdict } from '../engine.js';
import { assembleReport, truncateSnippet } from '../engine.js';
import { asWindow } from '../dom.js';
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

interface HtmlcsMessage {
  readonly type: number;
  readonly code: string;
  readonly msg: string;
  /**
   * The DOM element, not a string.
   *
   * The first version typed this as `string` and passed it straight to
   * truncateSnippet, which crashed with "html.replace is not a function" on
   * thirteen rules at once. HTML CodeSniffer hands back the live node, so the
   * snippet has to be read off it.
   */
  readonly element: unknown;
}

/** Reads an evidence snippet off whatever HTML CodeSniffer put in `element`. */
function snippetOf(element: unknown): string {
  if (typeof element === 'string') return element;
  if (typeof element !== 'object' || element === null) return '';
  const outer: unknown = Reflect.get(element, 'outerHTML');
  if (typeof outer === 'string') return outer;
  const tag: unknown = Reflect.get(element, 'tagName');
  return typeof tag === 'string' ? `<${tag.toLowerCase()}>` : '';
}

function narrowMessages(value: unknown): readonly HtmlcsMessage[] {
  if (!Array.isArray(value)) throw new TypeError('HTMLCS.getMessages did not return an array');
  return value as readonly HtmlcsMessage[];
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

export class HtmlcsEngine implements Engine {
  readonly id: EngineId = 'htmlcs';
  readonly requires: readonly Capability[] = ['dom'];
  readonly mapping = HTMLCS_MAPPING;

  get version(): string {
    return htmlcsVersion();
  }

  async evaluate(page: RenderedPage, actRuleIds: readonly ActRuleId[]): Promise<EngineReport> {
    const started = Date.now();
    const verdicts = new Map<ActRuleId, RawVerdict[]>();
    const errors = new Map<ActRuleId, string>();

    const claimed = actRuleIds.filter((id) => this.mapping.claimedRules.has(id));

    if (claimed.length > 0) {
      try {
        const window = asWindow(page.handle, 'html_codesniffer');
        window.eval(htmlcsSource());

        const raw: unknown = await Promise.resolve(
          window.eval(
            `new Promise((resolve) => {
               HTMLCS.process('WCAG2AA', document, function () { resolve(HTMLCS.getMessages()); });
             })`,
          ) as Promise<unknown>,
        );
        const messages = narrowMessages(raw);

        const spokenFor = new Set<ActRuleId>();

        for (const message of messages) {
          const normalised = normaliseCode(message.code);
          for (const entry of this.mapping.engineToAct(normalised)) {
            if (!actRuleIds.includes(entry.actId)) continue;
            const outcome = OUTCOME_BY_TYPE[message.type];
            if (outcome === undefined) continue;
            spokenFor.add(entry.actId);
            const list = verdicts.get(entry.actId) ?? [];
            list.push({
              engineRuleId: normalised,
              outcome,
              selector: ':root',
              snippet: truncateSnippet(snippetOf(message.element)),
              message: message.msg,
            });
            verdicts.set(entry.actId, list);
          }
        }

        // The inference described at the top of this file, made explicit rather than
        // left implicit: a rule this engine claims and said nothing about is reported
        // as passed. It is the weakest step in this adapter and the calibration table
        // is where the cost of it shows up.
        for (const actId of claimed) {
          if (spokenFor.has(actId)) continue;
          verdicts.set(actId, [
            {
              engineRuleId: this.mapping.actToEngine(actId)[0]?.engineRuleId ?? 'unknown',
              outcome: 'passed',
              selector: ':root',
              snippet: '',
              message:
                'HTML CodeSniffer reported nothing for this check. It emits only what it has ' +
                'something to say about, so silence is read as a pass.',
            },
          ]);
        }
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
