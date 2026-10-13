import { inPageExpression, unwrapInPageResult } from './engine.js';

/**
 * Narrow structural access to a rendered page's handle.
 *
 * `RenderedPage.handle` is `unknown` by design: a happy-dom `Window` and a Playwright
 * `Page` are not the same object, and an interface covering both would be a lowest
 * common denominator neither engine can use. So there are two narrow interfaces, one
 * per renderer, and an adapter picks its path by asking which one it was handed.
 *
 * The dependency rule `engines-go-through-the-render-seam` forbids importing happy-dom
 * or Playwright here, so these are hand-written structural types. That is not a
 * workaround: an adapter that constructed its own DOM could bypass the capability
 * model, and then a rule needing layout could silently pass on a renderer with none.
 */

/** The parts of a DOM window the adapters touch. What the static renderer hands over. */
export interface WindowLike {
  readonly document: DocumentLike;
  /** Evaluates a script in the window's realm. Used to inject browser-side engines. */
  eval(source: string): unknown;
}

export interface DocumentLike {
  readonly documentElement: ElementLike | null;
  querySelectorAll(selector: string): Iterable<ElementLike>;
}

export interface ElementLike {
  readonly tagName: string;
  readonly outerHTML: string;
  getAttribute(name: string): string | null;
}

/**
 * The parts of a Playwright page the adapters touch. What the browser renderer hands over.
 *
 * Two methods, and both cross a process boundary. `addScriptTag` puts an engine's source
 * into the page; `evaluate` runs an expression there and brings back whatever it returns,
 * which has to be structured-cloneable. Nothing that reaches a live node survives the trip,
 * so every adapter reads its evidence off the node inside the page and returns plain data.
 */
export interface BrowserPageLike {
  evaluate(expression: string): Promise<unknown>;
  addScriptTag(options: { readonly content: string }): Promise<unknown>;
}

export function isWindow(handle: unknown): handle is WindowLike {
  return (
    typeof handle === 'object' &&
    handle !== null &&
    'document' in handle &&
    typeof Reflect.get(handle, 'eval') === 'function'
  );
}

export function isBrowserPage(handle: unknown): handle is BrowserPageLike {
  return (
    typeof handle === 'object' &&
    handle !== null &&
    typeof Reflect.get(handle, 'evaluate') === 'function' &&
    typeof Reflect.get(handle, 'addScriptTag') === 'function'
  );
}

/**
 * Narrows a handle to a window, or explains why it is not one.
 *
 * A thrown error rather than a silent null. An adapter handed something it cannot read
 * should say so loudly, because the alternative is a report full of `inapplicable` that
 * looks like a clean page.
 */
export function asWindow(handle: unknown, engine: string): WindowLike {
  if (!isWindow(handle)) {
    throw new TypeError(
      `The ${engine} adapter needs a DOM window with an eval function, which is what the ` +
        'static renderer provides. This handle is not one.',
    );
  }
  return handle;
}

/** Narrows a handle to a browser page, or explains why it is not one. */
export function asBrowserPage(handle: unknown, engine: string): BrowserPageLike {
  if (!isBrowserPage(handle)) {
    throw new TypeError(
      `The ${engine} adapter needs a browser page with evaluate and addScriptTag functions, ` +
        'which is what the browser renderer provides. This handle is not one.',
    );
  }
  return handle;
}

/** A handle, sorted into the one of the two shapes an adapter knows how to evaluate. */
export type PageHandle =
  | { readonly kind: 'window'; readonly window: WindowLike }
  | { readonly kind: 'page'; readonly page: BrowserPageLike };

/**
 * Decides which path an adapter takes.
 *
 * The window is checked first, because a happy-dom window has neither `evaluate` nor
 * `addScriptTag` and a Playwright page has neither `document` nor `eval`, so the two
 * cannot be confused, and anything matching neither is refused with the same loud error
 * the adapters have always thrown.
 */
export function narrowHandle(handle: unknown, engine: string): PageHandle {
  if (isWindow(handle)) return { kind: 'window', window: handle };
  if (isBrowserPage(handle)) return { kind: 'page', page: handle };
  throw new TypeError(
    `The ${engine} adapter needs either a DOM window with an eval function, which the ` +
      'static renderer provides, or a browser page with evaluate and addScriptTag ' +
      'functions, which the browser renderer provides. It was handed neither.',
  );
}

/**
 * Injects an engine's script into a page once.
 *
 * Checked by global name rather than remembered per page, because the same page may be
 * evaluated more than once and an adapter has nowhere to keep state about a handle it
 * does not own. Injecting axe-core twice makes it throw; injecting a two megabyte bundle
 * twice merely wastes the time.
 *
 * The source is a function rather than a string so a bundle is only read off disk when
 * it is actually needed, which is what lets the unit suite exercise this path with a
 * fake page on a checkout that has never been built.
 */
export async function ensureScript(
  page: BrowserPageLike,
  globalName: string,
  source: () => string,
): Promise<void> {
  const present = await page.evaluate(`typeof globalThis[${JSON.stringify(globalName)}]`);
  if (present !== 'undefined') return;
  await page.addScriptTag({ content: source() });
}

/**
 * Runs an expression inside the page and returns what it produced, or throws what it
 * threw.
 *
 * The expression is wrapped so that an exception inside the page comes back as data
 * rather than as a Playwright error with the page's stack trace flattened into one line.
 * The adapter's own catch then records the message per rule, exactly as it does for a
 * failure on the window path.
 */
export async function evaluateInPage(page: BrowserPageLike, body: string): Promise<unknown> {
  return unwrapInPageResult(await page.evaluate(inPageExpression(body)));
}

/**
 * A CSS selector that identifies one element well enough for a human to find it.
 *
 * Not a canonical unique path. A full nth-child chain is unreadable in a pull request
 * body, and the source location is what a fix actually uses. This is orientation:
 * tag, id if present, and the first class.
 *
 * Self-contained on purpose: it reads nothing from module scope, so its source can be
 * carried into a browser page with `describeSelector.toString()` and applied to a live
 * element there. That is how the browser path uses the same convention as this one
 * without a second copy of the rule.
 */
export function describeSelector(element: ElementLike): string {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute('id');
  if (id !== null && id !== '') return `${tag}#${id}`;
  const className = element.getAttribute('class');
  if (className !== null && className.trim() !== '') {
    const first = className.trim().split(/\s+/)[0];
    if (first !== undefined) return `${tag}.${first}`;
  }
  return tag;
}

/** The selector convention as JavaScript source, for use inside a browser page. */
export function describeSelectorSource(): string {
  return `(${describeSelector.toString()})`;
}
