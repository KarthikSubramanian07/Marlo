import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import type { Capability, RendererId } from '@marlo/schema';
import { RENDERER_CAPABILITIES } from '@marlo/schema';
import type { RenderRequest, RenderedPage, Renderer } from './renderer.js';
import { DEFAULT_URL, validateRequest } from './renderer.js';

/**
 * The default renderer: happy-dom in this process. No browser binary, no network,
 * deterministic, milliseconds.
 *
 * This is what makes the cost constraint survivable. All three peer engines run
 * against it, which was measured before the architecture was chosen and is recorded
 * in RESEARCH.md §2.
 *
 * What it deliberately does not provide is `layout` and `paint`. happy-dom parses
 * CSS but does not perform layout, so `getComputedStyle` returns declared values
 * rather than resolved ones, and there is no box model. A contrast rule run here
 * would be reading numbers that do not describe what a user sees. Rather than
 * guessing, the capability set omits both, and every rule that needs them reports
 * `unsupported`.
 *
 * IT DOES EXECUTE INLINE PAGE SCRIPT, AND THAT IS NOT A CHOICE.
 *
 * This began as a `runScripts` option defaulting to false, with a comment about not
 * evaluating untrusted markup in the same process as the repair layer. The option
 * did not work. happy-dom 20 exposes `disableJavaScriptEvaluation` and
 * `enableJavaScriptEvaluation`, and inline scripts written through `document.write`
 * run under every combination of them. `DOMParser.parseFromString` executes them
 * too, which the HTML specification says it must not.
 *
 * So the option was removed rather than shipped. An option named `runScripts: false`
 * that runs scripts is worse than no option, because a caller would rely on it.
 * `script` is therefore declared as a genuine capability, and the limitation is
 * recorded in HONESTY.md and in SECURITY.md's data flow section rather than papered
 * over.
 *
 * Why it is acceptable, stated so a reader can disagree with the reasoning rather
 * than only with the conclusion. Marlo's surfaces scan code the caller already owns:
 * the CLI reads their files, the MCP server receives source an agent just wrote, the
 * Action reads their own checkout. That script is going to run in their browser
 * regardless. Marlo also performs no network fetches, so no external script is ever
 * pulled in. The genuinely hostile case is scanning a URL somebody else controls, and
 * Marlo deliberately does not offer that: there is no hosted scanner, for this reason
 * and for the cost reason in DECISIONS.md D-007. Untrusted content belongs on the
 * browser renderer, inside Chromium's sandbox.
 *
 * A parse-only mode is real work and is filed as such rather than faked here.
 */

export interface StaticRendererOptions {
  /**
   * Milliseconds to wait for happy-dom's task queue before giving up on it.
   *
   * Bounded because a page with a repeating timer would otherwise hold the run open,
   * and a scan that hangs is worse than one that reports late.
   */
  readonly settleTimeoutMs?: number;
}

const STATIC_CAPABILITIES: ReadonlySet<Capability> = new Set(RENDERER_CAPABILITIES.static);

export class StaticRenderer implements Renderer {
  readonly id: RendererId = 'static';
  readonly capabilities: ReadonlySet<Capability> = STATIC_CAPABILITIES;

  private readonly settleTimeoutMs: number;
  private readonly open = new Set<Window>();

  constructor(options: StaticRendererOptions = {}) {
    this.settleTimeoutMs = options.settleTimeoutMs ?? 2_000;
  }

  async render(request: RenderRequest): Promise<RenderedPage> {
    const problem = validateRequest(request);
    if (problem !== null) throw new TypeError(problem);

    const html =
      request.html ??
      (await readFile(
        // validateRequest guarantees exactly one of html and path, so path is
        // present here. The nullish coalescing is for the type checker; a throw
        // would be dead code.
        request.path ?? '',
        'utf8',
      ));
    const sourcePath = request.path ?? null;
    const url = request.url ?? DEFAULT_URL;

    const window = new Window({
      url,
      width: request.viewport?.width ?? 1280,
      height: request.viewport?.height ?? 800,
      settings: {
        // No network, whatever the markup asks for. Not a performance setting: a
        // scan has to produce the same answer offline as in CI, and a page that
        // fetches a stylesheet would otherwise make findings depend on whether a
        // CDN was reachable.
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
        enableImageFileLoading: false,
        disableIframePageLoading: true,
        handleDisabledFileLoadingAsSuccess: true,

        // A parse error is a finding, not a crash. The duplicate-id and
        // duplicate-attribute rules depend on the parser keeping what it was given.
        disableErrorCapturing: false,

        // happy-dom warns on every construction that this is an insecure JavaScript
        // environment. It is right, and the limitation is documented in HONESTY.md
        // and SECURITY.md. A library that writes to stderr on every call is noise
        // that teaches callers to ignore stderr, so the warning is suppressed here
        // and stated where a reader will actually read it.
        suppressInsecureJavaScriptEnvironmentWarning: true,
      },
    });

    this.open.add(window);
    window.document.write(html);

    // Waits for happy-dom's task queue: parsing, inline scripts if enabled, and
    // microtasks. Bounded, because a page with a repeating timer would otherwise
    // hold the run open and a scan that hangs is worse than one that reports late.
    await Promise.race([
      window.happyDOM.waitUntilComplete(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.settleTimeoutMs);
        // Do not let the timer itself hold the process open.
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);

    return {
      renderer: this.id,
      capabilities: this.capabilities,
      url,
      html,
      sourcePath,
      handle: window,
      serialize: () => window.document.documentElement.outerHTML,
      close: async () => {
        this.open.delete(window);
        await window.happyDOM.close();
      },
    };
  }

  async dispose(): Promise<void> {
    // A renderer that leaks windows shows up as a test suite that will not exit,
    // which is a confusing symptom for a clear cause.
    await Promise.all([...this.open].map((w) => w.happyDOM.close()));
    this.open.clear();
  }
}

/**
 * Installs a happy-dom window's globals onto `globalThis`, runs `fn`, and restores
 * whatever was there before.
 *
 * This exists for Alfa, and the reason is worth recording because it took four
 * attempts to find. `@siteimprove/alfa-dom/native` serialises a DOM by reading
 * `globalThis.document` and calling `createRange()` on it. It does not accept a
 * document as an argument for that part, so the window has to be global while it
 * runs. The result then has to be hydrated with `Node.from(json, device)` rather
 * than the more obvious `Document.fromDocument`, which returns a Trampoline.
 *
 * Restoring the previous globals matters more than it looks. Vitest runs test files
 * in the same process, and a leaked `globalThis.document` makes an unrelated test
 * fail somewhere else entirely.
 *
 * It lives in @marlo/render rather than in the Alfa adapter because
 * `engines-go-through-the-render-seam` in .dependency-cruiser.cjs forbids an engine
 * adapter from importing happy-dom directly: an adapter that reaches for the DOM
 * itself could bypass the capability model, and then a rule needing layout could
 * silently pass on a renderer that has none.
 */
export async function withDomGlobals<T>(window: unknown, fn: () => Promise<T>): Promise<T> {
  const w = window as Record<string, unknown>;
  const target = globalThis as unknown as Record<string, unknown>;

  // Only the names Alfa's serialiser actually reaches for, rather than every
  // property on the window. Copying everything has been tried and it clobbers
  // Node's own globals, including `performance` and `crypto`.
  const names = [
    'window',
    'document',
    'Node',
    'Element',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLTextAreaElement',
    'HTMLIFrameElement',
    'HTMLSlotElement',
    'HTMLStyleElement',
    'HTMLTemplateElement',
    'HTMLAnchorElement',
    'HTMLImageElement',
    'SVGElement',
    'Document',
    'DocumentFragment',
    'DocumentType',
    'ShadowRoot',
    'Attr',
    'Text',
    'Comment',
    'CSSStyleDeclaration',
    'CSSStyleSheet',
    'CSSRule',
    'StyleSheetList',
    'Range',
    'NodeFilter',
    'NodeList',
    'getComputedStyle',
  ];

  const saved = new Map<string, { had: boolean; value: unknown }>();
  for (const name of names) {
    saved.set(name, { had: name in target, value: target[name] });
    const replacement = name === 'window' ? window : w[name];
    if (replacement !== undefined) target[name] = replacement;
  }

  try {
    return await fn();
  } finally {
    for (const [name, previous] of saved) {
      if (previous.had) target[name] = previous.value;
      // Reflect.deleteProperty rather than `delete target[name]`, which the linter
      // forbids on a computed key. Removing rather than assigning undefined matters:
      // Alfa's serialiser checks `'document' in globalThis`, so an undefined value
      // would still look present.
      else Reflect.deleteProperty(target, name);
    }
  }
}
