import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DAILY_BROWSER_MS,
  render,
  setClock,
  setWait,
} from '../apps/fetcher/src/worker.mjs';

/** A KV namespace in memory, recording each put. */
const memoryKv = (initial = {}) => {
  const store = new Map(Object.entries(initial));
  return {
    store,
    puts: [],
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value, options) {
      this.puts.push([key, value, options]);
      store.set(key, value);
    },
  };
};

const post = (body, method = 'POST') =>
  new Request('https://marlo-fetcher/render', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
const content = (result, init = {}) =>
  Response.json({ success: true, result }, { headers: { 'X-Browser-Ms-Used': '612' }, ...init });

let waits;
let now;
beforeEach(() => {
  waits = [];
  now = new Date('2026-10-20T12:00:00Z');
  setClock(() => now);
  setWait(async (ms) => {
    waits.push(ms);
  });
});

describe('marlo-fetcher', () => {
  it('returns the HTML Browser Run rendered, without images, fonts or media', async () => {
    const seen = [];
    const env = {
      BUDGET: memoryKv(),
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
      BUDGET: memoryKv(),
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
    const env = {
      BUDGET: memoryKv(),
      BROWSER: { quickAction: async () => new Response('no', { status: 429 }) },
    };
    const response = await render(post({ url: 'https://example.com/' }), env);
    expect(response.status).toBe(503);
    expect((await response.json()).detail).toMatch(/busy/);
    expect(waits).toEqual([6000]);
  });

  it('applies the address rules itself', async () => {
    let used = false;
    const env = {
      BUDGET: memoryKv(),
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
      BUDGET: memoryKv(),
      BROWSER: {
        quickAction: async () => {
          throw new Error('boom');
        },
      },
    };
    expect((await render(post({ url: 'https://example.com/' }), thrown)).status).toBe(502);
    const empty = {
      BUDGET: memoryKv(),
      BROWSER: { quickAction: async () => Response.json({ success: false }) },
    };
    expect((await render(post({ url: 'https://example.com/' }), empty)).status).toBe(502);
    const big = {
      BUDGET: memoryKv(),
      BROWSER: { quickAction: async () => content('x'.repeat(3 * 1024 * 1024 + 1)) },
    };
    expect((await render(post({ url: 'https://example.com/' }), big)).status).toBe(413);
  });

  describe('the daily browser budget', () => {
    const today = 'browser-ms:2026-10-20';
    const browser = (calls, init) => ({
      async quickAction() {
        calls.push(1);
        return content('<p>ok</p>', init);
      },
    });

    it('charges each render the browser time Browser Run reports, under the UTC date', async () => {
      const calls = [];
      const budget = memoryKv({ [today]: '1000' });
      const response = await render(post({ url: 'https://example.com/' }), {
        BUDGET: budget,
        BROWSER: browser(calls),
      });
      expect(response.status).toBe(200);
      expect(budget.store.get(today)).toBe('1612');
      expect(budget.puts[0][2]).toEqual({ expirationTtl: 172800 });
    });

    it('refuses without starting a browser once the day is spent, and resets the next day', async () => {
      const calls = [];
      const budget = memoryKv({ [today]: String(DEFAULT_DAILY_BROWSER_MS) });
      const env = { BUDGET: budget, BROWSER: browser(calls) };
      const refused = await render(post({ url: 'https://example.com/' }), env);
      expect(refused.status).toBe(503);
      expect((await refused.json()).detail).toMatch(/used up.*midnight UTC/s);
      expect(calls).toHaveLength(0);
      now = new Date('2026-10-21T00:00:01Z');
      expect((await render(post({ url: 'https://example.com/' }), env)).status).toBe(200);
      expect(budget.store.get('browser-ms:2026-10-21')).toBe('612');
    });

    it('honours DAILY_BROWSER_MS, and ignores a value that is not a positive number', async () => {
      const calls = [];
      const env = { BUDGET: memoryKv({ [today]: '700' }), BROWSER: browser(calls) };
      expect(
        (await render(post({ url: 'https://example.com/' }), { ...env, DAILY_BROWSER_MS: '500' }))
          .status,
      ).toBe(503);
      expect(
        (await render(post({ url: 'https://example.com/' }), { ...env, DAILY_BROWSER_MS: 'lots' }))
          .status,
      ).toBe(200);
    });

    it('charges wall time when Browser Run reports none, and when it throws', async () => {
      const budget = memoryKv();
      const slow = {
        async quickAction() {
          now = new Date(now.getTime() + 4000);
          return Response.json({ success: true, result: '<p>x</p>' });
        },
      };
      await render(post({ url: 'https://example.com/' }), { BUDGET: budget, BROWSER: slow });
      expect(budget.store.get(today)).toBe('4000');
      const broken = {
        async quickAction() {
          now = new Date(now.getTime() + 2500);
          throw new Error('gone');
        },
      };
      const failed = await render(post({ url: 'https://example.com/' }), {
        BUDGET: budget,
        BROWSER: broken,
      });
      expect(failed.status).toBe(502);
      expect(budget.store.get(today)).toBe('6500');
    });

    it('does not charge a rate-limited attempt, which started no browser', async () => {
      let n = 0;
      const budget = memoryKv();
      const env = {
        BUDGET: budget,
        BROWSER: {
          async quickAction() {
            n += 1;
            return n === 1 ? new Response('wait', { status: 429 }) : content('<p>y</p>');
          },
        },
      };
      await render(post({ url: 'https://example.com/' }), env);
      expect(budget.puts).toHaveLength(1);
      expect(budget.store.get(today)).toBe('612');
    });

    it('refuses to render at all with no budget binding', async () => {
      const calls = [];
      const response = await render(post({ url: 'https://example.com/' }), {
        BROWSER: browser(calls),
      });
      expect(response.status).toBe(503);
      expect((await response.json()).detail).toMatch(/no daily budget/);
      expect(calls).toHaveLength(0);
    });
  });
});
