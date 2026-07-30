import type { Capability, RendererId } from '@marlo/schema';
import type { RenderRequest, RenderedPage, Renderer } from './renderer.js';

/**
 * The empty seam, and the reason it is empty.
 *
 * DECISIONS.md D-007 required the first dollar of variable cost to be identified
 * precisely. This is it.
 *
 * Everything Marlo ships costs nothing at any volume, because the compute is the
 * caller's own machine, unmetered public-repository Actions minutes, or static Pages
 * hosting with no egress charge. One thing breaks that: rendering a page in a real
 * browser on infrastructure Marlo pays for, which is what a hosted "scan this URL"
 * service would need. The candidate is Cloudflare Browser Rendering, metered by
 * browser time and concurrency.
 *
 * So this class implements the interface and throws. That is not laziness; it is the
 * design. Nothing Marlo currently does requires it, and an implemented remote
 * renderer would be a convenient thing to reach for, at which point the first dollar
 * becomes an unbounded number of dollars because nobody wrote the metering or the
 * cap. The seam being awkward is the point.
 *
 * If a hosted scanning surface is ever built, this is the line item, and the
 * graceful degradation is already specified: with no remote renderer available,
 * layout-dependent rules report `unsupported` rather than failing the run.
 *
 * Excluded from coverage in vitest.config.ts. Covering an interface with no
 * implementation would be covering a comment.
 */
export class RemoteRenderer implements Renderer {
  readonly id: RendererId = 'remote';
  /**
   * Declared as what it would provide, not as nothing. A caller inspecting
   * capabilities before choosing a renderer needs to know what this one is for.
   */
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>([
    'dom',
    'script',
    'layout',
    'paint',
  ]);

  render(_request: RenderRequest): Promise<RenderedPage> {
    return Promise.reject(
      new Error(
        'RemoteRenderer is a seam with no implementation, deliberately. See DECISIONS.md D-007:\n' +
          '  it is the only component with a per-unit cost, so it is not built until something\n' +
          '  needs it, and whatever builds it also has to build the metering and the cap.\n' +
          '  Use the static renderer, or the browser renderer on compute you already pay for.',
      ),
    );
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
