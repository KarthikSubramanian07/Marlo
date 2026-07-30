import type { Capability, RendererId } from '@marlo/schema';

/**
 * The renderer seam, and the capability model that makes it honest.
 *
 * The problem this solves, from DECISIONS.md D-005. Headless Chromium needs
 * roughly 300 MB and hundreds of milliseconds per page; free Cloudflare Workers
 * give 128 MB and 10 ms of CPU. That gap does not close with architecture. But all
 * three peer engines run against a Node DOM with no browser at all, so the question
 * is not how to afford Chromium, it is which rules genuinely need it.
 *
 * The answer is the dozen or so that need CSS layout, paint order, or interaction:
 * contrast, visible focus, zoom clipping, orientation lock, keyboard traps. Marlo
 * auto-fixes none of them.
 *
 * So a renderer declares what it provides, a rule declares what it needs, and a
 * rule whose needs are not met returns `unsupported`. Never a pass. That is the
 * difference between "no contrast problems were found" and "contrast was not
 * examined", and it is the sibling PDF project's principle that a check which
 * failed to run must never be indistinguishable from a check that found nothing.
 */

/**
 * A rendered page, as the engines see it.
 *
 * The `window` is deliberately typed as `unknown` at this boundary. Engine adapters
 * narrow it themselves, because a happy-dom `Window` and a Playwright `Page` handle
 * are not the same object and pretending they share an interface would produce a
 * lowest common denominator that neither engine can actually use.
 */
export interface RenderedPage {
  /** Which renderer produced this. Travels onto every finding. */
  readonly renderer: RendererId;
  /** What this page supports. A rule may not rely on anything absent from here. */
  readonly capabilities: ReadonlySet<Capability>;
  /** The URL the document believes it is at. Rules about links and language need it. */
  readonly url: string;
  /** The source that was rendered, byte-for-byte, for the repair layer to edit. */
  readonly html: string;
  /** The path the source came from, or null for a string the caller supplied. */
  readonly sourcePath: string | null;
  /**
   * The renderer's own handle. `happy-dom`'s `Window` for the static renderer, a
   * Playwright `Page` for the browser one. Adapters narrow it.
   */
  readonly handle: unknown;
  /** Serialises the document as it currently stands, after any script execution. */
  serialize(): string;
  /** Releases whatever the renderer holds. Idempotent. */
  close(): Promise<void>;
}

/** What a caller passes to a renderer. */
export interface RenderRequest {
  /** Raw HTML. Exactly one of `html` or `path` is required. */
  readonly html?: string;
  /** A file to read. Exactly one of `html` or `path` is required. */
  readonly path?: string;
  /**
   * The URL the document should believe it is at. Rules about same-page links and
   * about the document language depend on it, and defaulting it silently would make
   * those rules quietly renderer-dependent.
   */
  readonly url?: string;
  /** Viewport, for renderers that have one. Ignored by the static renderer. */
  readonly viewport?: { readonly width: number; readonly height: number };
}

export interface Renderer {
  readonly id: RendererId;
  /** Everything this renderer provides, for every page it produces. */
  readonly capabilities: ReadonlySet<Capability>;
  render(request: RenderRequest): Promise<RenderedPage>;
  /** Releases anything shared between renders, such as a browser process. */
  dispose(): Promise<void>;
}

/**
 * What a rule needs, and whether it got it.
 *
 * Returned rather than thrown, because "this rule cannot run here" is a result the
 * report has to carry, not an error that aborts the run. A scan that stops because
 * one rule wanted layout would be less useful than one that reports the other
 * ninety-three.
 */
export interface CapabilityCheck {
  readonly supported: boolean;
  /** Empty when supported. Otherwise exactly what was missing, for the report. */
  readonly missing: readonly Capability[];
}

/**
 * Does this page provide everything the rule requires?
 *
 * The one function every engine adapter must call before evaluating a rule. There
 * is a test asserting that no adapter reports a pass for a rule whose check failed.
 */
export function checkCapabilities(
  page: Pick<RenderedPage, 'capabilities'>,
  required: readonly Capability[],
): CapabilityCheck {
  const missing = required.filter((c) => !page.capabilities.has(c));
  return { supported: missing.length === 0, missing };
}

/**
 * Human-readable explanation of why a rule was not evaluated.
 *
 * Written here rather than at each call site so the phrasing cannot drift, and
 * phrased as what was not done rather than what was not found. "Contrast was not
 * examined" and "no contrast problems were found" are the two sentences this whole
 * model exists to keep apart.
 */
export function explainUnsupported(missing: readonly Capability[], renderer: RendererId): string {
  const needed = [...missing].sort().join(' and ');
  const remedy =
    renderer === 'static'
      ? ' Run with --renderer browser to evaluate it.'
      : ' No available renderer provides it.';
  return (
    `Not evaluated: this rule requires ${needed}, which the ${renderer} renderer does not ` +
    `provide. This is not a pass.${remedy}`
  );
}

/**
 * Validates a render request before anything touches the filesystem or a browser.
 *
 * Rejects both zero and two sources. Accepting both and picking one would mean a
 * caller who passed a path and a string got whichever the implementation happened
 * to prefer, which is the sort of thing nobody discovers until the wrong page is
 * scanned.
 */
export function validateRequest(request: RenderRequest): string | null {
  const hasHtml = request.html !== undefined;
  const hasPath = request.path !== undefined;

  if (!hasHtml && !hasPath) return 'A render request needs either html or path.';
  if (hasHtml && hasPath) {
    return 'A render request takes either html or path, not both. Pass one.';
  }
  if (request.url !== undefined) {
    try {
      new URL(request.url);
    } catch {
      return `"${request.url}" is not a valid absolute URL.`;
    }
  }
  if (request.viewport !== undefined) {
    const { width, height } = request.viewport;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      return 'A viewport needs positive integer width and height.';
    }
  }
  return null;
}

/**
 * The URL a document is told it is at when the caller did not say.
 *
 * A resolvable but obviously non-real origin. `about:blank` breaks relative URL
 * resolution, and a real domain would make a test look like it reached the network.
 */
export const DEFAULT_URL = 'https://marlo.invalid/';
