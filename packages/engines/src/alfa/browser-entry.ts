import { Native } from '@siteimprove/alfa-dom/native';
import { Node } from '@siteimprove/alfa-dom';
import { Page } from '@siteimprove/alfa-web';
import { Request, Response } from '@siteimprove/alfa-http';
import { Device } from '@siteimprove/alfa-device';
import { Audit } from '@siteimprove/alfa-act';
import { URL } from '@siteimprove/alfa-url';
import rules from '@siteimprove/alfa-rules';
import { recordOutcome, type AlfaOutcomeRecord } from './outcome.js';

/**
 * The entry point of the Alfa browser bundle.
 *
 * Bundled by esbuild as part of this package's `build` script into
 * `dist/alfa.browser.js`, as an immediately invoked script exposing `MarloAlfa`. The
 * adapter injects that file into a Playwright page and calls `MarloAlfa.audit(url)`.
 *
 * Alfa reaches `globalThis.document` directly, which in Node needs `withDomGlobals` to
 * stand a happy-dom window in for it. In a browser the document is simply there, so this
 * file is the Node adapter's audit with the scaffolding removed. The translation of each
 * outcome lives in `outcome.ts` and is shared, which is what keeps the two paths from
 * drifting.
 *
 * Nothing here imports a Node module, and the build fails if a transitive dependency does,
 * because the bundle is built for the browser platform.
 */

/**
 * Audits the current document as Alfa sees it, and returns plain records.
 *
 * The result is read into records before it is returned, because a Playwright
 * `evaluate` can only carry structured-cloneable values out of the page and an Alfa
 * outcome is a lazy object full of methods.
 */
export async function audit(pageUrl: string): Promise<AlfaOutcomeRecord[]> {
  const document: unknown = Reflect.get(globalThis, 'document');
  if (typeof document !== 'object' || document === null) {
    throw new Error('MarloAlfa.audit needs a document, and this realm has none');
  }

  const device = Device.standard();
  const serialised = await Native.fromNode(document as never);
  // Node.from, not Document.fromDocument. The latter returns a Trampoline and fails
  // later with "node.children is not a function". The cast narrows a runtime fact the
  // types cannot express: the input was a document, so the output is one.
  const alfaDocument = Node.from(serialised, device) as never;

  const url = URL.parse(pageUrl).getUnsafe();
  const page = Page.of(Request.of('GET', url), Response.of(url, 200), alfaDocument, device);

  const result = await Audit.of(page, rules).evaluate();
  return [...result].map((outcome) => recordOutcome(outcome));
}
