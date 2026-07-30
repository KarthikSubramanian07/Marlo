import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { ActRuleId, Capability, EngineId, EngineReport, Outcome } from '@marlo/schema';
import type { RenderedPage } from '@marlo/render';
import type { Engine, RawVerdict } from '../engine.js';
import { assembleReport, truncateSnippet } from '../engine.js';
import { asWindow } from '../dom.js';
import { AXE_MAPPING } from './mapping.js';

/**
 * axe-core, Deque's engine. MPL-2.0, consumed unmodified.
 *
 * Injected as source and evaluated inside the page's realm rather than imported as a
 * module. axe-core captures `window` at module scope, so importing it in Node binds
 * it to whatever global existed at import time, which is not the page. Evaluating the
 * bundle in the window is how every browser integration does it and it is what the
 * spike in RESEARCH.md §2 verified works against happy-dom.
 *
 * Reading the bundle from disk once and caching it costs about 4 MB of memory and
 * saves re-reading it per page.
 */

const require = createRequire(import.meta.url);

let cachedSource: string | null = null;
let cachedVersion: string | null = null;

function axeSource(): string {
  cachedSource ??= readFileSync(require.resolve('axe-core'), 'utf8');
  return cachedSource;
}

function axeVersion(): string {
  cachedVersion ??= ((): string => {
    const pkg: unknown = JSON.parse(readFileSync(require.resolve('axe-core/package.json'), 'utf8'));
    if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
      const version: unknown = Reflect.get(pkg, 'version');
      if (typeof version === 'string') return version;
    }
    // A version Marlo cannot read is a calibration table that cannot be reproduced,
    // so this is an error rather than a fallback string.
    throw new Error('cannot read the axe-core version');
  })();
  return cachedVersion;
}

/**
 * axe's own result vocabulary, mapped onto ACT's.
 *
 * The interesting one is `incomplete`. axe uses it for checks that need human
 * judgment, which is what ACT calls `cantTell`. Folding it into `passes`, as several
 * integrations do, is exactly the move that makes a tool report clean on a page it
 * did not understand.
 *
 * `inapplicable` is axe's own bucket for rules with no matching elements, and it maps
 * straight across.
 */
interface AxeNode {
  readonly target: readonly string[];
  readonly html: string;
  readonly failureSummary?: string;
}

interface AxeResult {
  readonly id: string;
  readonly help: string;
  readonly description: string;
  readonly nodes: readonly AxeNode[];
}

interface AxeRun {
  readonly violations: readonly AxeResult[];
  readonly passes: readonly AxeResult[];
  readonly incomplete: readonly AxeResult[];
  readonly inapplicable: readonly AxeResult[];
}

const OUTCOME_BY_BUCKET: Readonly<Record<keyof AxeRun, Outcome>> = Object.freeze({
  violations: 'failed',
  passes: 'passed',
  incomplete: 'cantTell',
  inapplicable: 'inapplicable',
});

function narrowRun(value: unknown): AxeRun {
  const buckets: (keyof AxeRun)[] = ['violations', 'passes', 'incomplete', 'inapplicable'];
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('axe.run returned a non-object');
  }
  for (const bucket of buckets) {
    if (!Array.isArray(Reflect.get(value, bucket))) {
      throw new TypeError(`axe.run result has no ${bucket} array`);
    }
  }
  return value as unknown as AxeRun;
}

export class AxeEngine implements Engine {
  readonly id: EngineId = 'axe-core';
  readonly requires: readonly Capability[] = ['dom'];
  readonly mapping = AXE_MAPPING;

  get version(): string {
    return axeVersion();
  }

  async evaluate(page: RenderedPage, actRuleIds: readonly ActRuleId[]): Promise<EngineReport> {
    const started = Date.now();
    const verdicts = new Map<ActRuleId, RawVerdict[]>();
    const errors = new Map<ActRuleId, string>();

    // The requested ACT rules translated into axe rule ids. Running only what is
    // needed rather than all 105 rules keeps a scan in the tens of milliseconds.
    const wanted = new Set<string>();
    for (const actId of actRuleIds) {
      for (const entry of this.mapping.actToEngine(actId)) wanted.add(entry.engineRuleId);
    }

    if (wanted.size > 0) {
      try {
        const window = asWindow(page.handle, 'axe-core');
        window.eval(axeSource());

        const options = JSON.stringify({
          runOnly: { type: 'rule', values: [...wanted].sort() },
          // Every bucket, because `passes` and `inapplicable` are the evidence that
          // the rule ran, and `incomplete` is cantTell.
          resultTypes: ['violations', 'passes', 'incomplete', 'inapplicable'],
          reporter: 'v2',
          // axe's own iframe traversal would need the frames to have loaded, and the
          // renderers deliberately do not load them.
          iframes: false,
          elementRef: false,
        });

        const raw: unknown = await Promise.resolve(
          window.eval(`axe.run(document, ${options})`) as Promise<unknown>,
        );
        const run = narrowRun(raw);

        for (const bucket of ['violations', 'passes', 'incomplete', 'inapplicable'] as const) {
          const outcome = OUTCOME_BY_BUCKET[bucket];
          for (const result of run[bucket]) {
            for (const entry of this.mapping.engineToAct(result.id)) {
              if (!actRuleIds.includes(entry.actId)) continue;
              const list = verdicts.get(entry.actId) ?? [];

              if (result.nodes.length === 0) {
                // `inapplicable` results carry no nodes. The absence is the finding.
                list.push({
                  engineRuleId: result.id,
                  outcome,
                  selector: ':root',
                  snippet: '',
                  message: result.help,
                });
              } else {
                for (const node of result.nodes) {
                  list.push({
                    engineRuleId: result.id,
                    outcome,
                    selector: node.target.join(' '),
                    snippet: truncateSnippet(node.html),
                    message: node.failureSummary ?? result.help,
                  });
                }
              }
              verdicts.set(entry.actId, list);
            }
          }
        }
      } catch (error) {
        // One failure marks every requested rule as errored rather than as clean.
        // axe runs the whole set in one call, so a throw means nothing was measured,
        // and reporting the unmeasured rules as passing is the defect this project
        // exists to argue against.
        const message = error instanceof Error ? error.message : String(error);
        for (const actId of actRuleIds) {
          if (this.mapping.claimedRules.has(actId)) errors.set(actId, message);
        }
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
