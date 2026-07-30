/**
 * @marlo/render
 *
 * The renderer seam and the capability model.
 *
 * The one idea here: a renderer declares what it provides, a rule declares what it
 * needs, and a rule whose needs are not met reports `unsupported`. Never a pass.
 * That single rule is the difference between "no contrast problems were found" and
 * "contrast was not examined", and it is why Marlo can run its default path with no
 * browser without quietly claiming coverage it does not have.
 *
 * Three implementations: `StaticRenderer` on happy-dom, which is the default and
 * needs nothing installed; `BrowserRenderer` on Playwright, opt-in, which adds
 * `layout` and `paint`; and `RemoteRenderer`, which is deliberately empty and
 * explains why in its own source.
 */

export type { CapabilityCheck, RenderRequest, RenderedPage, Renderer } from './renderer.js';
export { DEFAULT_URL, checkCapabilities, explainUnsupported, validateRequest } from './renderer.js';
export type { StaticRendererOptions } from './static.js';
export { StaticRenderer, withDomGlobals } from './static.js';
export type { BrowserRendererOptions } from './browser.js';
export { BrowserRenderer, PlaywrightMissingError } from './browser.js';
export { RemoteRenderer } from './remote.js';
