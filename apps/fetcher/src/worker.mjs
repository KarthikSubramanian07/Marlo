/**
 * marlo-fetcher: one page's HTML, as a real browser receives it.
 *
 * The site's own Worker fetches pages for the playground with a plain request. Some sites
 * refuse requests from Cloudflare's Workers, by network or by the header Workers add, and
 * some build themselves with JavaScript so their HTML holds nothing to check. For those
 * the site asks this Worker, which loads the page in Cloudflare Browser Run and returns
 * the HTML the browser ended up with. The rules still run in the visitor's browser.
 *
 * It has no public address. The site's FETCHER service binding is the only caller, and
 * the site has already applied the address rules; they are applied again here so this
 * Worker is safe on its own. Images, fonts and media are not downloaded: only the HTML
 * is wanted, and every skipped request is browser time not spent.
 *
 * Browser time is capped per UTC day by this Worker, not only by the plan. On the Workers
 * Free plan Cloudflare stops at ten minutes a day; on a paid plan it bills past the
 * included hours instead, so a busy day would cost money nobody decided to spend. The
 * budget lives in the BUDGET KV namespace, keyed by date, and every render is charged the
 * browser time Browser Run reports for it (or its wall time, when it reports none). With no
 * BUDGET binding the Worker refuses to render at all. KV is eventually consistent, so the
 * cap can be overrun by the renders already in flight when it is reached, a few browser
 * minutes at most; that bound is the reason the default is the free allowance rather than
 * something closer to the paid one.
 */
import { fetchableUrl } from '../../site/src/worker.mjs';

const LIMIT_BYTES = 3 * 1024 * 1024;

/**
 * Browser milliseconds per UTC day when DAILY_BROWSER_MS is not set: the Workers Free
 * allowance. Thirty-one such days are about 5.2 hours, inside the ten a paid plan includes.
 */
export const DEFAULT_DAILY_BROWSER_MS = 10 * 60 * 1000;

const budgetKey = (now) => `browser-ms:${now.toISOString().slice(0, 10)}`;

/** The clock, injected in tests. */
let clock = () => new Date();
export const setClock = (fn) => {
  clock = fn;
};

/** A pause, for the rate limit only. Injected in tests so they do not wait. */
let wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const setWait = (fn) => {
  wait = fn;
};

const refuse = (status, detail) => Response.json({ detail }, { status });

export async function render(request, env) {
  if (request.method !== 'POST') return refuse(405, 'POST a JSON body with a url.');
  let body;
  try {
    body = await request.json();
  } catch {
    return refuse(400, 'POST a JSON body with a url.');
  }
  const checked = fetchableUrl(body?.url, 'trymarlo.pages.dev');
  if (checked.error) return refuse(400, checked.error);
  if (env.BUDGET === undefined) {
    return refuse(503, 'The browser fallback has no daily budget configured, so it is off.');
  }
  const limit = Number(env.DAILY_BROWSER_MS);
  const budget = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_DAILY_BROWSER_MS;
  const key = budgetKey(clock());
  const spent = Number(await env.BUDGET.get(key)) || 0;
  if (spent >= budget) {
    return refuse(
      503,
      "Today's browser time for blocked pages is used up. It resets at midnight UTC, and the " +
        'CLI checks any page on your own machine.',
    );
  }
  let charged = 0;
  const charge = async (ms) => {
    charged += Math.max(0, Math.ceil(ms));
    // Two days, so yesterday's counter is still readable across midnight and then goes.
    await env.BUDGET.put(key, String(spent + charged), { expirationTtl: 2 * 24 * 60 * 60 });
  };
  // Browser Run limits how many browsers start per minute. When it says to wait, this
  // waits once, up to eight seconds, rather than sending the visitor away.
  let reply;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = clock().getTime();
    try {
      reply = await env.BROWSER.quickAction('content', {
        url: checked.url.href,
        gotoOptions: { waitUntil: 'networkidle2', timeout: 15000 },
        rejectResourceTypes: ['image', 'media', 'font'],
      });
    } catch (error) {
      await charge(clock().getTime() - started);
      return refuse(
        502,
        `Browser Run could not load the page: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // A 429 started no browser. Anything else is charged what Browser Run says it used.
    if (reply.status !== 429) {
      const used = Number(reply.headers.get('x-browser-ms-used'));
      await charge(Number.isFinite(used) && used > 0 ? used : clock().getTime() - started);
    }
    if (reply.status !== 429 || attempt === 1) break;
    const after = Number(reply.headers.get('retry-after'));
    await wait(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 6000, 8000));
  }
  if (!reply.ok) {
    const busy = reply.status === 429;
    return refuse(
      busy ? 503 : 502,
      busy
        ? 'The browser that loads blocked pages is busy. Try again in a minute.'
        : `A browser could not load the page (Browser Run answered ${String(reply.status)}).`,
    );
  }
  const data = await reply.json();
  if (data?.success !== true || typeof data.result !== 'string') {
    return refuse(502, 'A browser loaded the page but returned no HTML.');
  }
  const bytes = new TextEncoder().encode(data.result);
  if (bytes.byteLength > LIMIT_BYTES)
    return refuse(413, 'The page is larger than three megabytes.');
  return new Response(bytes, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Browser-Ms-Used': reply.headers.get('x-browser-ms-used') ?? '',
    },
  });
}

export default {
  fetch: (request, env) => render(request, env),
};
