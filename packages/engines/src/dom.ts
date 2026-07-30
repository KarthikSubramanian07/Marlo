/**
 * Narrow structural access to a rendered page's handle.
 *
 * `RenderedPage.handle` is `unknown` by design: a happy-dom `Window` and a Playwright
 * `Page` are not the same object, and an interface covering both would be a lowest
 * common denominator neither engine can use.
 *
 * The dependency rule `engines-go-through-the-render-seam` forbids importing
 * happy-dom here, so these are hand-written structural types. That is not a
 * workaround: an adapter that constructed its own DOM could bypass the capability
 * model, and then a rule needing layout could silently pass on a renderer with none.
 */

/** The parts of a DOM window the adapters touch. */
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
 * Narrows a handle to a window, or explains why it is not one.
 *
 * A thrown error rather than a silent null. An adapter handed a Playwright page when
 * it expected a happy-dom window should say so loudly, because the alternative is a
 * report full of `inapplicable` that looks like a clean page.
 */
export function asWindow(handle: unknown, engine: string): WindowLike {
  if (
    typeof handle !== 'object' ||
    handle === null ||
    !('document' in handle) ||
    typeof Reflect.get(handle, 'eval') !== 'function'
  ) {
    throw new TypeError(
      `The ${engine} adapter needs a DOM window with an eval function, which is what the ` +
        'static renderer provides. The browser renderer hands back a Playwright page instead, ' +
        'and that path is not implemented for this engine yet.',
    );
  }
  return handle as unknown as WindowLike;
}

/**
 * A CSS selector that identifies one element well enough for a human to find it.
 *
 * Not a canonical unique path. A full nth-child chain is unreadable in a pull request
 * body, and the source location is what a fix actually uses. This is orientation:
 * tag, id if present, and the first class.
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
