import { readFile } from 'node:fs/promises';
import type { Capability, RendererId } from '@marlo/schema';
import { RENDERER_CAPABILITIES } from '@marlo/schema';
import type { RenderRequest, RenderedPage, Renderer } from './renderer.js';
import { DEFAULT_URL, validateRequest } from './renderer.js';

/**
 * The high-fidelity renderer: real Chromium through Playwright.
 *
 * Opt-in, because it costs a browser download and roughly 300 MB of memory per
 * page, and because it executes page script. It provides `layout` and `paint`,
 * which is what the contrast, visible focus, zoom clipping, orientation and
 * keyboard trap rules need and what nothing else can supply honestly.
 *
 * Playwright is an optional peer dependency and is imported dynamically. That is
 * load-bearing rather than tidy: `pnpm install && pnpm test` has to be green with
 * no browser binary, so a static import here would break the one requirement the
 * whole offline story rests on.
 *
 * Where the compute comes from, per DECISIONS.md D-005: the caller's own machine, or
 * their CI. Public-repository Actions minutes are unmetered, which is one of the
 * reasons this repository is public. Marlo's own hosted surface never runs a
 * browser, which is why it has no monthly floor.
 */

const BROWSER_CAPABILITIES: ReadonlySet<Capability> = new Set(RENDERER_CAPABILITIES.browser);

export interface BrowserRendererOptions {
  /** Defaults to 1280x800, matching the static renderer so widths are comparable. */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Milliseconds. Applies to navigation and to setting content. */
  readonly timeoutMs?: number;
  /**
   * Emulated colour scheme. Contrast findings depend on it, so it is recorded rather
   * than left to Chromium's default, and a caller scanning a dark theme has to say
   * so rather than get a measurement of the light one.
   */
  readonly colorScheme?: 'light' | 'dark' | 'no-preference';
  /**
   * Emulated reduced-motion preference. Marlo's own surfaces are audited with this
   * set both ways, since respecting it is one of the dogfooding requirements.
   */
  readonly reducedMotion?: 'reduce' | 'no-preference';
}

/** Thrown when the browser renderer is asked for and Playwright is not installed. */
export class PlaywrightMissingError extends Error {
  constructor(cause: unknown) {
    super(
      'The browser renderer needs Playwright, which is an optional dependency.\n' +
        '  Install it:  pnpm add -D playwright && pnpm exec playwright install chromium\n' +
        '  Or use the default renderer, which needs no browser. Rules requiring layout\n' +
        '  will report as not evaluated rather than as passing.',
    );
    this.name = 'PlaywrightMissingError';
    this.cause = cause;
  }
}

/**
 * Minimal structural types for the parts of Playwright this file touches.
 *
 * Hand-written rather than imported, because importing Playwright's types would make
 * it a real dependency of the build and the whole point is that it is not one.
 */
interface PlaywrightPage {
  setContent(html: string, options?: { timeout?: number; waitUntil?: string }): Promise<void>;
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  content(): Promise<string>;
  close(): Promise<void>;
  route(pattern: string, handler: (route: { abort(): Promise<void> }) => void): Promise<void>;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightBrowser {
  newContext(options: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

interface ChromiumLauncher {
  launch(options: { headless: boolean; args?: readonly string[] }): Promise<PlaywrightBrowser>;
}

/**
 * Narrows the dynamically imported module to the one launcher this file uses.
 *
 * A runtime check rather than a cast, because the failure it guards against is real:
 * a Playwright major that moved or renamed `chromium` would otherwise produce
 * `undefined is not a function` at launch time, several frames from the cause.
 */
function narrowChromium(loaded: unknown): ChromiumLauncher {
  if (typeof loaded !== 'object' || loaded === null || !('chromium' in loaded)) {
    throw new PlaywrightMissingError(new Error('the playwright module has no chromium export'));
  }
  const candidate: unknown = Reflect.get(loaded, 'chromium');
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof Reflect.get(candidate, 'launch') !== 'function'
  ) {
    throw new PlaywrightMissingError(new Error('playwright.chromium has no launch function'));
  }
  return candidate as unknown as ChromiumLauncher;
}

export class BrowserRenderer implements Renderer {
  readonly id: RendererId = 'browser';
  readonly capabilities: ReadonlySet<Capability> = BROWSER_CAPABILITIES;

  private readonly options: BrowserRendererOptions;
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightContext | null = null;

  constructor(options: BrowserRendererOptions = {}) {
    this.options = options;
  }

  private async ensureContext(): Promise<PlaywrightContext> {
    if (this.context !== null) return this.context;

    let chromium: ChromiumLauncher;
    try {
      // The import is typed as unknown and narrowed at runtime rather than typed
      // against Playwright's own declarations. Referring to those declarations would
      // make Playwright a real dependency of the type check, and the requirement is
      // that a clean install with no browser still typechecks and tests green.
      const loaded: unknown = await import('playwright');
      chromium = narrowChromium(loaded);
    } catch (error) {
      if (error instanceof PlaywrightMissingError) throw error;
      throw new PlaywrightMissingError(error);
    }

    // One browser reused across renders. Launching per page turns a 200 ms scan
    // into a 2 s one, which is how a CI gate becomes a step people skip.
    this.browser = await chromium.launch({
      headless: true,
      // Chromium's sandbox is unavailable in most CI containers. This is the
      // documented workaround and it is why the browser renderer should only ever
      // be pointed at content the caller controls.
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    this.context = await this.browser.newContext({
      viewport: this.options.viewport ?? { width: 1280, height: 800 },
      colorScheme: this.options.colorScheme ?? 'light',
      reducedMotion: this.options.reducedMotion ?? 'no-preference',
      // Marlo reports what the source says, not what a CDN happens to serve today.
      // Deterministic scanning matters more than fidelity to third-party assets.
      bypassCSP: false,
      javaScriptEnabled: true,
    });

    return this.context;
  }

  async render(request: RenderRequest): Promise<RenderedPage> {
    const problem = validateRequest(request);
    if (problem !== null) throw new TypeError(problem);

    const context = await this.ensureContext();
    const page = await context.newPage();
    const timeout = this.options.timeoutMs ?? 15_000;

    // No network. A scan has to produce the same result on a train as in CI, and a
    // page that fetches a font from a CDN would otherwise make contrast findings
    // depend on whether that CDN was reachable. Blocking is deliberate and is
    // reported: a rule that needed a blocked resource reports cantTell rather than
    // passing.
    await page.route('**/*', (route) => {
      void route.abort();
    });

    const html = request.html ?? (await readFile(request.path ?? '', 'utf8'));
    const url = request.url ?? DEFAULT_URL;

    if (request.path !== undefined || request.html !== undefined) {
      await page.setContent(html, { timeout, waitUntil: 'domcontentloaded' });
    }

    return {
      renderer: this.id,
      capabilities: this.capabilities,
      url,
      html,
      sourcePath: request.path ?? null,
      handle: page,
      // Synchronous by interface, and Playwright's content() is not. The rendered
      // source is captured at render time for the repair layer; a caller wanting the
      // post-script DOM should read it through the engine adapter, which is async.
      serialize: () => html,
      close: async () => {
        await page.close();
      },
    };
  }

  async dispose(): Promise<void> {
    if (this.context !== null) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser !== null) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
