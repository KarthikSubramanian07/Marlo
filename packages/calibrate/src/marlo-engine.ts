import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { ActRuleId, Capability, EngineId, EngineReport } from '@marlo/schema';
import type { RenderedPage } from '@marlo/render';
import type { Engine } from '@marlo/engines';
import { buildMapping } from '@marlo/engines';
import {
  IMPLEMENTED_RULES,
  buildDocument,
  evaluateRules,
  findMarloRule,
  type SourceElement,
} from '@marlo/rules';

/**
 * Wraps @marlo/rules in the peer `Engine` interface so the harness measures Marlo the
 * same way it measures everyone else.
 *
 * The wrapper lives here rather than in @marlo/rules because a dependency rule forbids
 * @marlo/rules from importing @marlo/engines, per D-008. That is not an inconvenience
 * being worked around: it is the reason the wrapper is a separate, thin file that adds
 * no logic. Marlo's rules produce their verdicts without any knowledge that peers exist,
 * and this file only relabels the result.
 *
 * There is a test asserting this file contains no verdict logic, because a "wrapper"
 * that started adjusting outcomes would be exactly the self-audit the boundary exists
 * to prevent.
 */

const require = createRequire(import.meta.url);

let cachedVersion: string | null = null;

function marloVersion(): string {
  cachedVersion ??= ((): string => {
    const pkg: unknown = JSON.parse(
      readFileSync(require.resolve('@marlo/rules/package.json'), 'utf8'),
    );
    if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
      const version: unknown = Reflect.get(pkg, 'version');
      if (typeof version === 'string') return version;
    }
    throw new Error('cannot read the @marlo/rules version');
  })();
  return cachedVersion;
}

/** Narrows a renderer handle to the DOM shape @marlo/rules can convert. */
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

  evaluate(page: RenderedPage, actRuleIds: readonly ActRuleId[]): Promise<EngineReport> {
    const implemented = actRuleIds.filter((id) => findMarloRule(id) !== undefined);
    if (implemented.length === 0) {
      return Promise.resolve(
        evaluateRules(actRuleIds, {
          document: buildDocument(
            { nodeType: 1, nodeName: 'html', childNodes: [], textContent: '' },
            { url: page.url, hasDoctype: false, computedStyleFor: null },
          ),
          renderer: page.renderer,
          capabilities: page.capabilities,
          version: this.version,
        }),
      );
    }

    const { root, hasDoctype } = documentOf(page.handle);
    const document = buildDocument(root, {
      url: page.url,
      hasDoctype,
      // Resolved styles are offered only when the renderer actually provides layout.
      // Passing a function that returns declared values would be a computed style that
      // does not describe what a user sees, which is the failure the whole capability
      // model exists to prevent.
      computedStyleFor: null,
    });

    return Promise.resolve(
      evaluateRules(actRuleIds, {
        document,
        renderer: page.renderer,
        capabilities: page.capabilities,
        version: this.version,
      }),
    );
  }
}
