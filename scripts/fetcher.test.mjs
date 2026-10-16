import { beforeEach, describe, expect, it } from 'vitest';
import { render, setWait } from '../apps/fetcher/src/worker.mjs';

const post = (body, method = 'POST') =>
  new Request('https://marlo-fetcher/render', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
const content = (result, init = {}) =>
  Response.json({ success: true, result }, { headers: { 'X-Browser-Ms-Used': '612' }, ...init });

let waits;
beforeEach(() => {
  waits = [];
  setWait(async (ms) => {
    waits.push(ms);
  });
});

describe('marlo-fetcher', () => {
  it('returns the HTML Browser Run rendered, without images, fonts or media', async () => {
    const seen = [];
    const env = {
      BROWSER: {
        async quickAction(action, options) {
          seen.push([action, options]);
          return content('<html><p>hi</p></html>');
        },
      },
    };
    const response = await render(post({ url: 'https://www.w3.org/demo' }), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html><p>hi</p></html>');
    expect(response.headers.get('x-browser-ms-used')).toBe('612');
    expect(seen[0][0]).toBe('content');
    expect(seen[0][1].url).toBe('https://www.w3.org/demo');
    expect(seen[0][1].rejectResourceTypes).toEqual(['image', 'media', 'font']);
  });

  it('waits once when Browser Run is rate limited, then tries again', async () => {
    let n = 0;
    const env = {
      BROWSER: {
        async quickAction() {
          n += 1;
          return n === 1
            ? new Response('slow down', { status: 429, headers: { 'Retry-After': '3' } })
            : content('<p>second time</p>');
        },
      },
    };
    const response = await render(post({ url: 'https://example.com/' }), env);
    expect(await response.text()).toBe('<p>second time</p>');
    expect(waits).toEqual([3000]);
  });

  it('gives up after the second rate limit and says the browser is busy', async () => {
    const env = { BROWSER: { quickAction: async () => new Response('no', { status: 429 }) } };
    const response = await render(post({ url: 'https://example.com/' }), env);
    expect(response.status).toBe(503);
    expect((await response.json()).detail).toMatch(/busy/);
    expect(waits).toEqual([6000]);
  });

  it('applies the address rules itself', async () => {
    let used = false;
    const env = {
      BROWSER: {
        quickAction: async () => {
          used = true;
          return content('x');
        },
      },
    };
    for (const url of ['http://169.254.169.254/', 'https://localhost/', 'ftp://example.com/']) {
      expect((await render(post({ url }), env)).status).toBe(400);
    }
    expect((await render(post({}, 'GET'), env)).status).toBe(405);
    expect(used).toBe(false);
  });

  it('reports a failed or empty render, and a page over the cap', async () => {
    const thrown = {
      BROWSER: {
        quickAction: async () => {
          throw new Error('boom');
        },
      },
    };
    expect((await render(post({ url: 'https://example.com/' }), thrown)).status).toBe(502);
    const empty = { BROWSER: { quickAction: async () => Response.json({ success: false }) } };
    expect((await render(post({ url: 'https://example.com/' }), empty)).status).toBe(502);
    const big = { BROWSER: { quickAction: async () => content('x'.repeat(3 * 1024 * 1024 + 1)) } };
    expect((await render(post({ url: 'https://example.com/' }), big)).status).toBe(413);
  });
});
