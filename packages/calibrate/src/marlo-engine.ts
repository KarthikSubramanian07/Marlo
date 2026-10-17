import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { ActRuleId, Capability, EngineId } from '@trymarlo/schema';
import { EngineReport } from '@trymarlo/schema';
import type { RenderedPage } from '@trymarlo/render';
import type { Engine } from '@trymarlo/engines';
import {
  assembleReport,
  buildMapping,
  bundlePath,
  ensureScript,
  evaluateInPage,
  narrowHandle,
  readBundle,
} from '@trymarlo/engines';
import {
  IMPLEMENTED_RULES,
  buildDocument,
  evaluateRules,
  findMarloRule,
  type SourceElement,
} from '@trymarlo/rules';

/**
 * Wraps @trymarlo/rules in the peer `Engine` interface so the harness measures Marlo the
 * same way it measures everyone else.
 *
 * The wrapper lives here rather than in @trymarlo/rules because a dependency rule forbids
 * @trymarlo/rules from importing @trymarlo/engines, per D-008. That is not an inconvenience
 * being worked around: it is the reason the wrapper is a separate, thin file that adds
 * no logic. Marlo's rules produce their verdicts without any knowledge that peers exist,
 * and this file only relabels the result.
 *
 * There is a test asserting this file contains no verdict logic, because a "wrapper"
 * that started adjusting outcomes would be exactly the self-audit the boundary exists
 * to prevent.
 *
 * Two paths, chosen by narrowing the handle. A happy-dom window is converted in this
 * process with no resolved styles, so the layout rules report `unsupported`. A Playwright
 * page gets the rules injected as a bundle, `dist/marlo.browser.js`, and evaluated inside
 * it with the real computed styles and boxes; the finished report crosses back as JSON and
 * is validated against the schema before anything reads it.
 */

const require = createRequire(import.meta.url);

let cachedVersion: string | null = null;
let cachedBundle: string | null = null;

function marloVersion(): string {
  cachedVersion ??= ((): string => {
    const pkg: unknown = JSON.parse(
      readFileSync(require.resolve('@trymarlo/rules/package.json'), 'utf8'),
    );
    if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
      const version: unknown = Reflect.get(pkg, 'version');
      if (typeof version === 'string') return version;
    }
    throw new Error('cannot read the @trymarlo/rules version');
  })();
  return cachedVersion;
}

/** Where the build puts the rules browser bundle. Works from `src` and from `dist`. */
export function marloBundlePath(): string {
  return bundlePath(require.resolve('@trymarlo/calibrate/package.json'), 'marlo.browser.js');
}

function marloBundleSource(): string {
  cachedBundle ??= readBundle(marloBundlePath(), 'Marlo rules');
  return cachedBundle;
}

/** Narrows a renderer handle to the DOM shape @trymarlo/rules can convert. */
function documentOf(handle: unknown): { root: SourceElement; hasDoctype: boolean } {
  if (typeof handle !== 'object' || handle === null || !('document' in handle)) {
    throw new TypeError('the marlo engine needs a DOM window');
  }
  const document: unknown = Reflect.get(handle, 'document');
  if (typeof document !== 'object' || document === null) {
    throw new TypeError('the renderer handle has no document');
  }
  const root: unknown = Reflect.get(document, 'documentElement');
  if (typeof root !== 'object' || root === null) {
    throw new TypeError('the document has no documentElement');
  }
  const doctype: unknown = Reflect.get(document, 'doctype');
  return { root: root as SourceElement, hasDoctype: doctype !== null && doctype !== undefined };
}

/**
 * Marlo's own rule identifiers, mapped to ACT one to one.
 *
 * Trivially exact, because Marlo's rules are written against ACT rule identifiers in the
 * first place. Recorded as a mapping anyway so the harness treats every engine
 * identically and Marlo gets no special path, which is the whole of D-008.
 */
const MARLO_MAPPING = buildMapping(
  IMPLEMENTED_RULES.map((actId) => ({
    engineRuleId: `marlo/${actId}`,
    actId,
    kind: 'exact' as const,
    note:
      'Marlo implements ACT rules directly, so the mapping is one to one by construction ' +
      'rather than by measurement. The accuracy figures are still measured.',
  })),
);

export class MarloEngine implements Engine {
  readonly id: EngineId = 'marlo';
  readonly mapping = MARLO_MAPPING;

  get version(): string {
    return marloVersion();
  }

  /**
   * The union of what any implemented rule needs would be `layout` and `paint`, because
   * of the contrast rules. Declaring that here would make every rule unsupported on the
   * static renderer, so the engine declares only `dom` and each rule's own `requires` is
   * checked per rule inside `evaluateRules`. That is finer-grained than the peers manage
   * and it is why Marlo can report 33 rules while declining 2.
   */
  readonly requires: readonly Capability[] = ['dom'];

  async evaluate(page: RenderedPage, actRuleIds: readonly ActRuleId[]): Promise<EngineReport> {
    const implemented = actRuleIds.filter((id) => findMarloRule(id) !== undefined);
    if (implemented.length === 0) {
      return evaluateRules(actRuleIds, {
        document: buildDocument(
          { nodeType: 1, nodeName: 'html', childNodes: [], textContent: '' },
          { url: page.url, hasDoctype: false, computedStyleFor: null, boxFor: null },
        ),
        renderer: page.renderer,
        capabilities: page.capabilities,
        version: this.version,
      });
    }

    const handle = narrowHandle(page.handle, 'marlo');

    if (handle.kind === 'page') {
      const started = Date.now();
      try {
        await ensureScript(handle.page, 'MarloRules', marloBundleSource);
        const options = JSON.stringify({
          url: page.url,
          renderer: page.renderer,
          capabilities: [...page.capabilities],
          version: this.version,
        });
        const raw = await evaluateInPage(
          handle.page,
          `return MarloRules.evaluate(${JSON.stringify(actRuleIds)}, ${options});`,
        );
        // Validated rather than cast. The report was produced in another process by a
        // bundle built from some revision of @trymarlo/rules, and the schema is the contract.
        return EngineReport.parse(raw);
      } catch (error) {
        // A real page can fail in ways a happy-dom window cannot: a meta refresh or a
        // script navigates it away and destroys the context mid-evaluation, or the bundle
        // is missing. That is one page that could not be measured, reported per rule as
        // `error` exactly as the peer adapters report it, and `error` is never a pass.
        // Throwing instead would take the whole scan or calibration run down with it.
        const message = error instanceof Error ? error.message : String(error);
        return assembleReport({
          engine: this.id,
          engineVersion: this.version,
          page,
          requested: actRuleIds,
          requires: this.requires,
          mapping: this.mapping,
          verdicts: new Map(),
          errors: new Map(implemented.map((id) => [id, message])),
          durationMs: Date.now() - started,
        });
      }
    }

    const { root, hasDoctype } = documentOf(handle.window);
    const document = buildDocument(root, {
      url: page.url,
      hasDoctype,
      // Resolved styles are offered only when the renderer actually provides layout.
      // Passing a function that returns declared values would be a computed style that
      // does not describe what a user sees, which is the failure the whole capability
      // model exists to prevent.
      computedStyleFor: null,
      boxFor: null,
    });

    return evaluateRules(actRuleIds, {
      document,
      renderer: page.renderer,
      capabilities: page.capabilities,
      version: this.version,
    });
  }
}
