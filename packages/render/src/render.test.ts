import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Capability } from '@marlo/schema';

import {
  DEFAULT_URL,
  RemoteRenderer,
  StaticRenderer,
  checkCapabilities,
  explainUnsupported,
  validateRequest,
  withDomGlobals,
} from './index.js';
import { BrowserRenderer, PlaywrightMissingError } from './browser.js';

/**
 * The capability model is the reason this package exists, so most of these tests are
 * about what a renderer refuses to claim rather than about what it renders.
 *
 * The load-bearing one is "reports the missing capability rather than a pass". If
 * the static renderer ever declared `layout`, the contrast rules would start
 * returning verdicts computed from styles that were never resolved, and every one
 * of those verdicts would be wrong in a direction nobody would notice.
 */

const renderers: StaticRenderer[] = [];

function makeStatic(options?: ConstructorParameters<typeof StaticRenderer>[0]): StaticRenderer {
  const renderer = new StaticRenderer(options);
  renderers.push(renderer);
  return renderer;
}

afterEach(async () => {
  await Promise.all(renderers.splice(0).map((r) => r.dispose()));
});

describe('the capability model', () => {
  it('gives the static renderer dom and script but never layout or paint', () => {
    // happy-dom parses CSS but does not perform layout, so getComputedStyle returns
    // declared values rather than resolved ones and there is no box model. A
    // contrast rule run here would read numbers that do not describe what a user
    // sees, so the capability is absent rather than approximated.
    const renderer = makeStatic();
    expect([...renderer.capabilities].sort()).toEqual(['dom', 'script']);
    expect(renderer.capabilities.has('layout')).toBe(false);
    expect(renderer.capabilities.has('paint')).toBe(false);
  });

  it('gives the browser renderer everything', () => {
    expect([...new BrowserRenderer().capabilities].sort()).toEqual([
      'dom',
      'layout',
      'paint',
      'script',
    ]);
  });

  it('reports the missing capability rather than a pass', async () => {
    // THE test in this package. A rule that needs layout, on a renderer with none,
    // must come back as "not evaluated" with the gap named. Anything that turns this
    // into `supported: true` is a silent false negative across every contrast,
    // focus, zoom and keyboard rule at once.
    const page = await makeStatic().render({ html: '<p>text</p>' });

    const contrast = checkCapabilities(page, ['dom', 'layout']);
    expect(contrast.supported).toBe(false);
    expect(contrast.missing).toEqual(['layout']);

    const domOnly = checkCapabilities(page, ['dom']);
    expect(domOnly.supported).toBe(true);
    expect(domOnly.missing).toEqual([]);

    await page.close();
  });

  it('names every missing capability, not just the first', async () => {
    const page = await makeStatic().render({ html: '<p>text</p>' });
    const check = checkCapabilities(page, ['dom', 'layout', 'paint']);
    expect([...check.missing].sort()).toEqual(['layout', 'paint']);
    await page.close();
  });

  it('treats an empty requirement list as satisfied', async () => {
    const page = await makeStatic().render({ html: '<p>text</p>' });
    expect(checkCapabilities(page, []).supported).toBe(true);
    await page.close();
  });

  it('explains the gap as what was not done rather than what was not found', () => {
    // The two sentences this whole model exists to keep apart.
    const message = explainUnsupported(['layout'], 'static');
    expect(message).toContain('Not evaluated');
    expect(message).toContain('This is not a pass');
    expect(message).toContain('--renderer browser');
    expect(message).not.toMatch(/no .* problems/i);
  });

  it('does not suggest the browser renderer when the browser is already in use', () => {
    const message = explainUnsupported(['paint'], 'browser');
    expect(message).not.toContain('--renderer browser');
    expect(message).toContain('No available renderer provides it');
  });

  it('lists missing capabilities in a stable order', () => {
    // Report output is compared against golden files, so ordering cannot depend on
    // the order a caller happened to declare requirements in.
    const a = explainUnsupported(['paint', 'layout'], 'static');
    const b = explainUnsupported(['layout', 'paint'], 'static');
    expect(a).toBe(b);
  });
});

describe('validateRequest', () => {
  it('accepts html alone or path alone', () => {
    expect(validateRequest({ html: '<p>a</p>' })).toBeNull();
    expect(validateRequest({ path: 'a.html' })).toBeNull();
  });

  it('rejects neither and both', () => {
    // Accepting both and picking one means a caller who passed a path and a string
    // gets whichever the implementation prefers, which is the sort of thing nobody
    // finds until the wrong page has been scanned.
    expect(validateRequest({})).toContain('either html or path');
    expect(validateRequest({ html: '<p>a</p>', path: 'a.html' })).toContain('not both');
  });

  it('rejects a URL that is not absolute', () => {
    expect(validateRequest({ html: '', url: '/relative' })).toContain('not a valid absolute URL');
    expect(validateRequest({ html: '', url: 'https://example.test/x' })).toBeNull();
  });

  it('rejects a nonsensical viewport', () => {
    expect(validateRequest({ html: '', viewport: { width: 0, height: 100 } })).toContain(
      'positive integer',
    );
    expect(validateRequest({ html: '', viewport: { width: 800.5, height: 100 } })).toContain(
      'positive integer',
    );
    expect(validateRequest({ html: '', viewport: { width: 800, height: 600 } })).toBeNull();
  });
});

describe('StaticRenderer', () => {
  it('renders a string and reports where it came from', async () => {
    const page = await makeStatic().render({
      html: '<html lang="en"><body><p>hi</p></body></html>',
    });
    expect(page.renderer).toBe('static');
    expect(page.sourcePath).toBeNull();
    expect(page.url).toBe(DEFAULT_URL);
    expect(page.serialize()).toContain('<p>hi</p>');
    await page.close();
  });

  it('renders a file and keeps the path for the repair layer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'marlo-render-'));
    const file = join(dir, 'page.html');
    writeFileSync(file, '<html><body><img src="a.png"></body></html>', 'utf8');

    const page = await makeStatic().render({ path: file });
    expect(page.sourcePath).toBe(file);
    // The repair layer edits byte ranges in this exact string, so it has to be the
    // source rather than a serialisation of the parsed document.
    expect(page.html).toBe('<html><body><img src="a.png"></body></html>');
    await page.close();
  });

  it('honours the URL the caller gave, because rules depend on it', async () => {
    // Same-page link rules and language rules both read the document URL. Defaulting
    // it silently would make those rules quietly renderer-dependent.
    const page = await makeStatic().render({
      html: '<a href="#main">skip</a>',
      url: 'https://example.test/docs/',
    });
    expect(page.url).toBe('https://example.test/docs/');
    await page.close();
  });

  it('parses markup a browser would have to tolerate', async () => {
    // Duplicate ids and duplicate attributes are two ACT rules, so the parser has to
    // keep the document rather than reject it.
    const page = await makeStatic().render({
      html: '<div id="x"></div><div id="x"></div><p class="a" class="b">t</p>',
    });
    const serialized = page.serialize();
    expect(serialized).toContain('id="x"');
    await page.close();
  });

  it('executes inline page script, which is a limitation rather than a feature', async () => {
    // Asserted rather than wished away. This started as a runScripts option
    // defaulting to false; the option did not work, because happy-dom 20 runs inline
    // scripts written through document.write under every combination of
    // disableJavaScriptEvaluation and enableJavaScriptEvaluation, and DOMParser runs
    // them too. An option named runScripts: false that runs scripts is worse than no
    // option, so it was removed and the limitation is in HONESTY.md.
    //
    // This test exists so that if happy-dom ever gains a working switch, it fails and
    // somebody revisits the documentation rather than the documentation quietly
    // becoming wrong.
    const page = await makeStatic().render({
      html: '<html><body><div id="host"></div><script>document.getElementById("host").textContent = "ran"</script></body></html>',
    });
    expect(page.serialize()).toContain('ran');
    await page.close();
  });

  it('fetches nothing, whatever the markup asks for', async () => {
    // A scan has to give the same answer offline as in CI. A page that pulls a
    // stylesheet would otherwise make findings depend on whether a CDN was up.
    const page = await makeStatic().render({
      html:
        '<html><head><link rel="stylesheet" href="https://cdn.invalid/a.css">' +
        '<script src="https://cdn.invalid/a.js"></script></head>' +
        '<body><img src="https://cdn.invalid/a.png" alt=""></body></html>',
    });
    expect(page.serialize()).toContain('cdn.invalid');
    await page.close();
  });

  it('does not hang on a page with a repeating timer', async () => {
    // A scan that hangs is worse than one that reports late, so the settle wait is
    // bounded. Without the bound this test never finishes.
    const renderer = makeStatic({ settleTimeoutMs: 150 });
    const started = Date.now();
    const page = await renderer.render({
      html: '<html><body><script>setInterval(() => {}, 10)</script></body></html>',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    await page.close();
  });

  it('rejects an invalid request before touching the filesystem', async () => {
    await expect(makeStatic().render({})).rejects.toThrow(TypeError);
    await expect(makeStatic().render({ html: '', path: 'a.html' })).rejects.toThrow(/not both/);
  });

  it('closes cleanly and can be disposed twice', async () => {
    const renderer = new StaticRenderer();
    const page = await renderer.render({ html: '<p>a</p>' });
    await page.close();
    await renderer.dispose();
    await renderer.dispose();
  });
});

describe('withDomGlobals', () => {
  it('makes the document global for the duration and then removes it', async () => {
    // Alfa's serialiser reads globalThis.document and calls createRange on it. It
    // does not take a document argument for that part, so the window has to be
    // global while it runs.
    const page = await makeStatic().render({ html: '<html><body><p>a</p></body></html>' });
    const before = 'document' in globalThis;

    const tagName = await withDomGlobals(page.handle, () => {
      const doc = Reflect.get(globalThis, 'document');
      expect(doc).toBeDefined();
      expect(typeof Reflect.get(doc as object, 'createRange')).toBe('function');
      return Promise.resolve('ok');
    });

    expect(tagName).toBe('ok');
    // Vitest runs test files in one process. A leaked globalThis.document makes an
    // unrelated test fail somewhere else entirely, which is why this is asserted.
    expect('document' in globalThis).toBe(before);
    await page.close();
  });

  it('restores a pre-existing global rather than deleting it', async () => {
    const target = globalThis as unknown as Record<string, unknown>;
    const sentinel = { marker: 'previous' };
    target['document'] = sentinel;

    const page = await makeStatic().render({ html: '<p>a</p>' });
    await withDomGlobals(page.handle, () => Promise.resolve());
    expect(target['document']).toBe(sentinel);

    Reflect.deleteProperty(target, 'document');
    await page.close();
  });

  it('restores globals even when the callback throws', async () => {
    const page = await makeStatic().render({ html: '<p>a</p>' });
    const had = 'document' in globalThis;

    await expect(
      withDomGlobals(page.handle, () => Promise.reject(new Error('engine exploded'))),
    ).rejects.toThrow('engine exploded');

    expect('document' in globalThis).toBe(had);
    await page.close();
  });
});

describe('RemoteRenderer', () => {
  it('declares what it would provide, not nothing', () => {
    // A caller inspecting capabilities before choosing a renderer needs to know what
    // this one is for, even though it is unimplemented.
    const remote = new RemoteRenderer();
    expect([...remote.capabilities].sort()).toEqual(['dom', 'layout', 'paint', 'script']);
  });

  it('refuses to render, and says why in terms of the cost decision', async () => {
    // DECISIONS.md D-007. The seam being awkward is the design: an implemented
    // remote renderer is a convenient thing to reach for, and the first dollar
    // becomes unbounded when whoever reaches for it has not written the cap.
    await expect(new RemoteRenderer().render({ html: '<p>a</p>' })).rejects.toThrow(/D-007/);
    await new RemoteRenderer().dispose();
  });
});

describe('BrowserRenderer', () => {
  it('constructs without needing Playwright installed', () => {
    // Construction has to be free. `pnpm install && pnpm test` must be green with no
    // browser binary, so the import is dynamic and happens on first render.
    expect(() => new BrowserRenderer()).not.toThrow();
    expect(new BrowserRenderer().id).toBe('browser');
  });

  it('disposes cleanly when it was never used', async () => {
    await new BrowserRenderer().dispose();
  });

  it('explains how to install Playwright rather than throwing a module error', async () => {
    // A caller who asked for --renderer browser without the dependency should get
    // the two commands that fix it, not ERR_MODULE_NOT_FOUND.
    const error = new PlaywrightMissingError(new Error('not found'));
    expect(error.message).toContain('playwright install chromium');
    expect(error.message).toContain('report as not evaluated rather than as passing');
    expect(error.name).toBe('PlaywrightMissingError');
  });
});

describe('capability declarations agree with the schema', () => {
  it('never lets a renderer claim a capability outside the vocabulary', () => {
    const known: readonly Capability[] = ['dom', 'script', 'layout', 'paint'];
    for (const renderer of [new StaticRenderer(), new BrowserRenderer(), new RemoteRenderer()]) {
      for (const capability of renderer.capabilities) {
        expect(known).toContain(capability);
      }
    }
  });
});
