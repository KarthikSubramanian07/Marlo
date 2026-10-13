import type { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type { ActRuleId, EngineId } from '@marlo/schema';
import { ActRuleId as ActRuleIdSchema, Outcome } from '@marlo/schema';
import type { Engine } from '@marlo/engines';
import { collapseOutcome } from '@marlo/engines';
import type { Renderer } from '@marlo/render';

/**
 * Evaluating a real page, bounded in time.
 *
 * An ACT test case is a few hundred bytes and finishes in milliseconds. A real page is up
 * to two megabytes of framework markup and inlined CSS, and an engine can take most of a
 * minute on one under happy-dom, or never finish. A `Promise.race` against a timer cannot
 * stop synchronous work, so each evaluation runs in its own worker thread, and a worker
 * that runs past the cap is terminated and its page recorded as errored. Never as a pass:
 * an evaluation that did not finish produced no verdict, and an absent verdict read as
 * clean is the failure the whole capability model exists to prevent.
 *
 * Every engine goes through this one path with the same cap, which is DECISIONS.md D-008:
 * a different timeout for Marlo's own engine would be an exemption.
 */

/** What one engine concluded about one rule on one page. */
export const RuleOnPage = z.object({
  actRuleId: ActRuleIdSchema,
  status: z.enum(['ok', 'error', 'unsupported']),
  /** The collapsed outcome when `status` is ok, otherwise null. */
  outcome: Outcome.nullable(),
  /** Failed verdicts, one per element flagged. */
  findings: z.number().int().nonnegative(),
});
export type RuleOnPage = z.infer<typeof RuleOnPage>;

const WorkerReply = z.object({ results: z.array(RuleOnPage) });

/** One engine on one page. `errored` is set when the whole evaluation failed. */
export interface PageEvaluation {
  readonly results: readonly RuleOnPage[];
  /** Why nothing came back: the evaluation threw, the worker died, or it ran out of time. */
  readonly errored: string | null;
}

/**
 * Renders a page and evaluates it, in whatever thread calls it. The worker entry point is
 * a thin wrapper around this, so the logic is tested here without a worker.
 */
export async function evaluatePage(
  engine: Engine,
  renderer: Renderer,
  request: { readonly html: string; readonly url: string },
  rules: readonly ActRuleId[],
): Promise<PageEvaluation> {
  const page = await renderer.render(request);
  try {
    const report = await engine.evaluate(page, rules);
    return {
      errored: null,
      results: rules.map((actRuleId) => {
        const result = report.results.find((r) => r.actRuleId === actRuleId);
        // An engine that omits a requested rule is a bug in that adapter, recorded as an
        // error exactly as the ACT pass records it.
        if (result === undefined) return { actRuleId, status: 'error', outcome: null, findings: 0 };
        return {
          actRuleId,
          status: result.status,
          outcome: result.status === 'ok' ? collapseOutcome(result.verdicts) : null,
          findings: result.verdicts.filter((v) => v.outcome === 'failed').length,
        };
      }),
    };
  } finally {
    await page.close();
  }
}

/**
 * Runs one worker to completion or to the cap, whichever comes first, and always
 * terminates it. The worker posts exactly one message.
 */
export function runWorker(spawn: () => Worker, timeoutMs: number): Promise<PageEvaluation> {
  return new Promise((settle) => {
    const worker = spawn();
    let done = false;
    const finish = (evaluation: PageEvaluation): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      settle(evaluation);
    };
    const timer = setTimeout(() => {
      finish({ results: [], errored: `timed out after ${String(timeoutMs)} ms` });
    }, timeoutMs);
    worker.on('message', (message: unknown) => {
      const parsed = WorkerReply.safeParse(message);
      finish(
        parsed.success
          ? { results: parsed.data.results, errored: null }
          : { results: [], errored: 'the worker replied with something that is not a result' },
      );
    });
    worker.on('error', (error: Error) => {
      finish({ results: [], errored: error.message });
    });
    worker.on('exit', (code) => {
      finish({ results: [], errored: `the worker exited with code ${String(code)} and no result` });
    });
  });
}

/** Maps with at most `limit` jobs in flight, preserving input order in the output. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (let index = next++; index < items.length; index = next++) {
      // `index < items.length` is the loop guard, so the element exists.
      out[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(lanes);
  return out;
}

/** What the worker entry point receives. */
export interface WorkerJob {
  readonly html: string;
  readonly url: string;
  readonly engine: EngineId;
  readonly rules: readonly ActRuleId[];
}
