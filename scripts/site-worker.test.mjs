import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSiteWorker, quality } from '../apps/site/src/worker.mjs';
import { createPublicApi } from '../apps/site/src/public-api.mjs';

const root = resolve(import.meta.dirname, '..');
const origin = 'https://trymarlo.pages.dev';
const table = JSON.parse(readFileSync(resolve(root, 'calibration/table.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'corpus/act/MANIFEST.json'), 'utf8'));
const api = createPublicApi({ origin, table, manifest });
const pages = {
  '/': '# Marlo\n\nMeasured accessibility evidence.\n',
  '/docs/': '# Marlo documentation\n\nRead published measurements.\n',
};
const worker = createSiteWorker({ origin, pages, api });
const assets = {
  '/': '<!doctype html><h1>Marlo</h1>',
  '/docs/': '<!doctype html><h1>Documentation</h1>',
  '/docs/index.md': pages['/docs/'],
  '/style.css': 'body { color: white }',
  '/404.html': '<!doctype html><h1>Resource not found</h1>',
};
const env = {
  ASSETS: {
    fetch(request) {
      const path = new URL(request.url).pathname;
      return new Response(assets[path] ?? assets['/404.html'], {
        status: Object.hasOwn(assets, path) ? 200 : 404,
        headers: { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/html' },
      });
    },
  },
};
const fetch = (path, options) => worker.fetch(new Request(`${origin}${path}`, options), env);
const rpc = (message, extra = {}) =>
  fetch('/mcp', {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...extra,
    },
    body: JSON.stringify(message),
  });
const request = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });

describe('representation negotiation', () => {
  it.each([
    [undefined, 1],
    ['text/markdown', 1],
    ['text/html', 0],
    ['text/*;q=0.5, text/markdown;q=0.8', 0.8],
    ['text/markdown;q=0, */*;q=1', 0],
    ['text/*;q=0, */*;q=1', 0],
    ['text/markdown;q=2', 0],
    ['text/markdown;q=invalid', 0],
  ])('respects Accept %s', (accept, expected) => {
    expect(quality(accept, 'text/markdown')).toBe(expected);
  });
  it.each([
    'text/markdown',
    'text/markdown;q=0.8, text/html;q=0.2',
    'TEXT/MARKDOWN',
    'text/markdown, */*;q=1',
  ])('serves homepage Markdown for %s', async (accept) => {
    const response = await fetch('/', { headers: { Accept: accept } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(response.headers.get('vary')).toContain('Accept');
    expect(await response.text()).toBe(pages['/']);
  });
  it.each([undefined, 'text/html', '*/*', 'text/markdown;q=0, */*;q=1'])(
    'preserves HTML for %s',
    async (accept) => {
      const response = await fetch('/', { headers: accept ? { Accept: accept } : {} });
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('vary')).toContain('Accept');
      expect(await response.text()).toContain('<!doctype html>');
    },
  );
  it.each(['/docs', '/docs/', '/docs/index.html'])('negotiates page alias %s', async (path) => {
    expect(await (await fetch(path, { headers: { Accept: 'text/markdown' } })).text()).toBe(
      pages['/docs/'],
    );
  });
  it('rejects unsupported representations', async () => {
    const response = await fetch('/', { headers: { Accept: 'image/png' } });
    expect(response.status).toBe(406);
    expect((await response.json()).code).toBe('NOT_ACCEPTABLE');
  });
  it('types explicit Markdown resources and keeps styles', async () => {
    expect((await fetch('/docs/index.md')).headers.get('content-type')).toContain('text/markdown');
    expect(await (await fetch('/style.css')).text()).toBe(assets['/style.css']);
  });
  it.each(['/unpublished', '/deeply/nested/missing', '/unknown.json', '/_worker.js', '/404.html'])(
    'returns a real explained Markdown 404 for %s',
    async (path) => {
      const response = await fetch(path, { headers: { Accept: 'text/markdown' } });
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      const body = await response.text();
      expect(body.length).toBeGreaterThan(20);
      expect(body).toContain('/llms.txt');
      expect(body).toContain('/docs/');
    },
  );
  it('returns HTML 404 and empty HEAD with the same headers', async () => {
    const response = await fetch('/missing');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Resource not found');
    const head = await fetch('/missing', { method: 'HEAD', headers: { Accept: 'text/markdown' } });
    expect(head.status).toBe(404);
    expect(head.headers.get('content-type')).toContain('text/markdown');
    expect(await head.text()).toBe('');
  });
});

describe('public API and discovery', () => {
  it.each([
    ['/api/v1/coverage', api.coverage],
    ['/api/v1/rules', api.rules],
    ['/api/v1/calibration', table],
    ['/openapi.json', api.openapi],
    ['/.well-known/mcp', api.mcpManifest],
    ['/api/v1/rules/c487ae', api.rules.rules.find((rule) => rule.id === 'c487ae')],
  ])('serves the published resource %s', async (path, value) => {
    const response = await fetch(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual(value);
  });
  it.each([
    ['/api/not-found', undefined, 404, 'RESOURCE_NOT_FOUND'],
    ['/api/v1/rules/zzzzzz', undefined, 404, 'RULE_NOT_FOUND'],
    ['/api/v1/rules/invalid', undefined, 400, 'INVALID_RULE_ID'],
    ['/api/v1/coverage', { method: 'POST' }, 405, 'METHOD_NOT_ALLOWED'],
    ['/api/v1/coverage', { headers: { Accept: 'text/html' } }, 406, 'NOT_ACCEPTABLE'],
  ])('returns actionable JSON errors for %s', async (path, options, status, code) => {
    const response = await fetch(path, options);
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      type: 'about:blank',
      status,
      code,
      instance: path,
      hint: expect.any(String),
      docs: `${origin}/docs/`,
    });
  });
  it('supports anonymous CORS preflight and HEAD', async () => {
    expect((await fetch('/api/v1/coverage', { method: 'OPTIONS' })).status).toBe(204);
    const head = await fetch('/api/v1/coverage', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
  it('adds security and discovery to generated responses', async () => {
    const response = await fetch('/api/v1/coverage');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('link')).toContain('/openapi.json');
    expect(response.headers.get('link')).toContain('/llms.txt');
  });
});

describe('stateless Streamable HTTP MCP', () => {
  it('initializes, accepts initialized notification, lists and calls every tool', async () => {
    const initialize = await rpc(
      request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1' },
      }),
    );
    expect(await initialize.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'marlo' },
      },
    });
    expect(initialize.headers.get('mcp-session-id')).toBeNull();
    const notification = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe('');
    const listed = await (
      await rpc(request('tools/list'), { 'MCP-Protocol-Version': '2025-11-25' })
    ).json();
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(api.mcpManifest.tools);
    for (const [name, args, data] of [
      ['marlo_coverage', {}, api.coverage],
      ['marlo_list_rules', {}, api.rules],
      [
        'marlo_explain_rule',
        { actRuleId: 'c487ae' },
        api.rules.rules.find((rule) => rule.id === 'c487ae'),
      ],
    ]) {
      const result = await (await rpc(request('tools/call', { name, arguments: args }))).json();
      expect(result.result.structuredContent).toEqual(data);
      expect(JSON.parse(result.result.content[0].text)).toEqual(data);
      expect(result.result.isError).toBe(false);
    }
  });
  it.each(['2025-03-26', '2025-06-18', 'future-version'])(
    'negotiates protocol %s',
    async (version) => {
      const response = await rpc(
        request('initialize', {
          protocolVersion: version,
          capabilities: {},
          clientInfo: { name: 'client', version: '1' },
        }),
      );
      expect((await response.json()).result.protocolVersion).toBe(
        version === 'future-version' ? '2025-11-25' : version,
      );
    },
  );
  it('rejects foreign Origin and unknown protocol headers', async () => {
    expect((await rpc(request('ping'), { Origin: 'https://unrelated.example' })).status).toBe(403);
    expect((await rpc(request('ping'), { 'MCP-Protocol-Version': 'unknown' })).status).toBe(400);
    expect((await rpc(request('ping'), { Origin: origin })).status).toBe(200);
  });
  it.each(['GET', 'DELETE'])(
    'does not advertise unsupported sessions or event streams for %s',
    async (method) => {
      const response = await fetch('/mcp', { method });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    },
  );
  it('requires the transport Accept and JSON content type', async () => {
    expect((await rpc(request('ping'), { Accept: 'application/json' })).status).toBe(406);
    expect((await rpc(request('ping'), { 'Content-Type': 'text/plain' })).status).toBe(415);
  });
  it.each([
    [[], -32600],
    [{ jsonrpc: '2.0', id: null, method: 'ping' }, -32600],
    [request('unknown'), -32601],
    [request('initialize'), -32602],
    [request('tools/call', { name: 'unknown' }), -32602],
  ])('returns protocol errors for invalid messages', async (message, code) => {
    expect((await (await rpc(message)).json()).error.code).toBe(code);
  });
  it('keeps tool execution failures distinct from protocol errors', async () => {
    const response = await rpc(
      request('tools/call', { name: 'marlo_explain_rule', arguments: { actRuleId: 'zzzzzz' } }),
    );
    expect((await response.json()).result.isError).toBe(true);
  });
  it.each([
    { name: 'marlo_explain_rule', arguments: {} },
    { name: 'marlo_coverage', arguments: { unexpected: true } },
  ])('returns argument validation as a tool error', async (params) => {
    const response = await rpc(request('tools/call', params));
    const body = await response.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text.length).toBeGreaterThan(20);
    expect(body.error).toBeUndefined();
  });
  it('accepts request metadata while rejecting unsupported pagination', async () => {
    const response = await rpc(request('tools/list', { _meta: { progressToken: 'test' } }));
    expect((await response.json()).result.tools).toHaveLength(3);
    const invalid = await rpc(request('tools/list', { cursor: 'invalid' }));
    expect((await invalid.json()).error.code).toBe(-32602);
  });
  it('preserves conditional and range request headers when forwarding assets', async () => {
    let forwarded;
    const response = await worker.fetch(
      new Request(`${origin}/style.css`, {
        headers: { Range: 'bytes=0-3', 'If-None-Match': 'known' },
      }),
      {
        ASSETS: {
          fetch(request) {
            forwarded = request;
            return new Response('body', { status: 206 });
          },
        },
      },
    );
    expect(response.status).toBe(206);
    expect(forwarded.headers.get('range')).toBe('bytes=0-3');
    expect(forwarded.headers.get('if-none-match')).toBe('known');
  });
  it('caps streamed requests even without a Content-Length', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(65537));
        controller.close();
      },
    });
    const response = await fetch('/mcp', {
      method: 'POST',
      duplex: 'half',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body,
    });
    expect(response.status).toBe(413);
    const invalid = await fetch('/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: '{',
    });
    expect((await invalid.json()).error.code).toBe(-32700);
  });
  it('handles concurrent requests without shared sessions or results', async () => {
    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, id) =>
        rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'marlo_coverage' } }),
      ),
    );
    const results = await Promise.all(responses.map((response) => response.json()));
    expect(results.map((result) => result.id)).toEqual(Array.from({ length: 100 }, (_, id) => id));
    expect(
      results.every(
        (result) =>
          result.result.structuredContent.coverage.implemented === table.coverage.implemented,
      ),
    ).toBe(true);
  });
});

describe('the try page policy', () => {
  it('allows script on /try/ only, and no request there', async () => {
    const { TRY_CSP } = await import('../apps/site/src/try-page.mjs');
    const withTry = createSiteWorker({ origin, pages, api, tryCsp: TRY_CSP });
    const get = (path) => withTry.fetch(new Request(`${origin}${path}`), env);
    const tryPolicy = (await get('/try/playground.js')).headers.get('content-security-policy');
    expect(tryPolicy).toBe(TRY_CSP);
    expect(tryPolicy).toContain("script-src 'self'");
    expect(tryPolicy).toContain("connect-src 'self' https://api.github.com");
    const home = (await get('/')).headers.get('content-security-policy');
    expect(home).not.toContain('script-src');
  });

  it('leaves every policy alone when no try policy is configured', async () => {
    const response = await fetch('/try/');
    expect(response.headers.get('content-security-policy')).not.toContain('script-src');
  });
});

describe('the playground page fetch', () => {
  const page = '<!doctype html><title>Hi</title><p>Hello</p>';
  const html = (body = page, headers = {}) =>
    new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers },
    });
  const make = (outbound) => createSiteWorker({ origin, pages, api, outbound });
  const call = (w, target, site = 'same-origin') =>
    w.fetch(
      new Request(`${origin}/try/fetch?url=${encodeURIComponent(target)}`, {
        headers: site === null ? {} : { 'Sec-Fetch-Site': site },
      }),
      env,
    );

  it('returns the page as bytes with the final address and declared type', async () => {
    const seen = [];
    const w = make(async (url, init) => {
      seen.push([url, init.redirect, init.headers['User-Agent']]);
      return html();
    });
    const response = await call(w, 'https://example.com/a#frag');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('x-marlo-final-url')).toBe('https://example.com/a');
    expect(response.headers.get('x-marlo-content-type')).toMatch(/text\/html/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe(page);
    expect(seen).toEqual([
      ['https://example.com/a', 'manual', expect.stringMatching(/^MarloPlayground/)],
    ]);
  });

  it('serves only same-origin callers', async () => {
    const w = make(async () => html());
    expect((await call(w, 'https://example.com/', 'cross-site')).status).toBe(403);
    expect((await call(w, 'https://example.com/', null)).status).toBe(403);
  });

  it.each([
    'http://10.0.0.1/',
    'https://localhost/',
    'https://printer.local/',
    'https://example.com:8443/',
    'https://user:pass@example.com/',
    'file:///etc/passwd',
    'https://trymarlo.pages.dev/',
    'https://intranet/',
  ])('refuses %s without fetching it', async (target) => {
    let fetched = false;
    const w = make(async () => {
      fetched = true;
      return html();
    });
    const response = await call(w, target);
    expect(response.status).toBe(400);
    expect(fetched).toBe(false);
  });

  it('re-checks every redirect, and refuses one into a private address', async () => {
    const w = make(async (url) =>
      url === 'https://example.com/'
        ? new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } })
        : html(),
    );
    const response = await call(w, 'https://example.com/');
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('REDIRECT_REFUSED');
  });

  it('follows a public redirect and reports where it landed', async () => {
    const w = make(async (url) =>
      url === 'http://example.com/'
        ? new Response(null, { status: 301, headers: { Location: 'https://www.example.com/' } })
        : html(),
    );
    const response = await call(w, 'http://example.com/');
    expect(response.headers.get('x-marlo-final-url')).toBe('https://www.example.com/');
  });

  it('gives up after five redirects', async () => {
    let n = 0;
    const w = make(async () => {
      n += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: `https://example.com/${String(n)}` },
      });
    });
    expect((await (await call(w, 'https://example.com/')).json()).code).toBe('TOO_MANY_REDIRECTS');
  });

  it('refuses what is not HTML, and what declares itself too large', async () => {
    const pdf = make(
      async () => new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } }),
    );
    expect((await call(pdf, 'https://example.com/a.pdf')).status).toBe(422);
    const big = make(async () => html('x', { 'Content-Length': String(4 * 1024 * 1024) }));
    expect((await call(big, 'https://example.com/')).status).toBe(413);
  });

  it('cuts off a body that grows past the cap without declaring it', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const w = make(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(chunk);
            },
          }),
          { headers: { 'Content-Type': 'text/html' } },
        ),
    );
    const response = await call(w, 'https://example.com/');
    await expect(response.arrayBuffer()).rejects.toThrow(/three megabytes/);
  });

  it('says so when the site errors or cannot be reached', async () => {
    const down = make(async () => new Response('no', { status: 503 }));
    expect((await (await call(down, 'https://example.com/')).json()).code).toBe('UPSTREAM_STATUS');
    const gone = make(async () => {
      throw new TypeError('fetch failed');
    });
    expect((await (await call(gone, 'https://example.com/')).json()).code).toBe(
      'UPSTREAM_UNREACHABLE',
    );
  });
});

describe('the browser fallback for pages that refuse a plain fetch', () => {
  const ok = () =>
    new Response('<p>plain</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const status = (n) => async () => new Response('no', { status: n });
  const fetcherThat = (reply) => {
    const calls = [];
    return {
      calls,
      FETCHER: {
        async fetch(url, init) {
          calls.push(JSON.parse(init.body).url);
          return typeof reply === 'function' ? reply() : reply;
        },
      },
    };
  };
  const call = (outbound, extraEnv, target, query = '') =>
    createSiteWorker({ origin, pages, api, outbound }).fetch(
      new Request(`${origin}/try/fetch?url=${encodeURIComponent(target)}${query}`, {
        headers: { 'Sec-Fetch-Site': 'same-origin' },
      }),
      { ...env, ...extraEnv },
    );
  const browserPage = () =>
    new Response('<p>from a browser</p>', { headers: { 'Content-Type': 'text/html' } });

  it('asks a real browser when the site refuses the plain fetch, and says it did', async () => {
    const f = fetcherThat(browserPage);
    const response = await call(status(403), f, 'https://www.w3.org/demo');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-marlo-via')).toBe('browser');
    expect(await response.text()).toBe('<p>from a browser</p>');
    expect(f.calls).toEqual(['https://www.w3.org/demo']);
  });

  it('uses the plain fetch when it works, and never starts a browser', async () => {
    const f = fetcherThat(browserPage);
    const response = await call(async () => ok(), f, 'https://example.com/');
    expect(response.headers.get('x-marlo-via')).toBe('fetch');
    expect(f.calls).toEqual([]);
  });

  it('does not ask a browser about a page that is simply not there', async () => {
    const f = fetcherThat(browserPage);
    const response = await call(status(404), f, 'https://example.com/missing');
    expect((await response.json()).code).toBe('UPSTREAM_STATUS');
    expect(f.calls).toEqual([]);
  });

  it('never sends a refused address to the browser', async () => {
    const f = fetcherThat(browserPage);
    expect((await call(status(403), f, 'http://10.0.0.5/')).status).toBe(400);
    expect(f.calls).toEqual([]);
  });

  it('reports both refusals when the browser fails too', async () => {
    const f = fetcherThat(
      () => new Response(JSON.stringify({ detail: 'The browser is busy.' }), { status: 503 }),
    );
    const body = await (await call(status(419), f, 'https://news.example.com/')).json();
    expect(body.code).toBe('UPSTREAM_STATUS');
    expect(body.detail).toBe('The site answered with status 419. The browser is busy.');
    expect(body.hint).toMatch(/bookmarklet/);
  });

  it('goes straight to the browser when the playground asks for a rendered page', async () => {
    let plain = 0;
    const f = fetcherThat(browserPage);
    const response = await call(
      async () => {
        plain += 1;
        return ok();
      },
      f,
      'https://app.example.com/',
      '&render=1',
    );
    expect(response.headers.get('x-marlo-via')).toBe('browser');
    expect(plain).toBe(0);
  });

  it('says so when no browser is configured', async () => {
    const response = await call(async () => ok(), {}, 'https://app.example.com/', '&render=1');
    expect((await response.json()).code).toBe('BROWSER_UNAVAILABLE');
  });

  it('refuses a browser page over the size cap', async () => {
    const f = fetcherThat(() => new Response(new Uint8Array(3 * 1024 * 1024 + 1)));
    expect((await call(status(403), f, 'https://example.com/')).status).toBe(413);
  });
});
