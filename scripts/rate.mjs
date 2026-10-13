#!/usr/bin/env node
/**
 * A local rating interface over one rater's worksheet for the real-page corpus. The
 * protocol it serves is corpus/real/adjudication/PROTOCOL.md, and the worksheet format,
 * validation and pre-screen are the ones in scripts/adjudicate.mjs, imported rather than
 * copied.
 *
 * Usage:
 *   node scripts/rate.mjs --rater A|B [--port N]
 *
 * It starts an HTTP server on 127.0.0.1 (a random free port unless --port is given) and
 * prints the address. The page on the left is the vendored snapshot itself, served with a
 * content security policy that blocks every network load, inside an iframe sandboxed
 * without scripts. On the right is the current cell, one page and one rule, taken in the
 * worksheet's own seeded order and never reordered. Every answer is written straight back to the worksheet through a
 * temporary file and a rename, so a crash leaves either the old sheet or the new one.
 *
 * Independence is enforced here, not requested. The server reads files only from a fixed
 * allow-list built at start-up: this rater's sheet, the two corpus manifests, the pages
 * the real manifest lists, the interface files and two fonts. A request path is never
 * joined onto the filesystem. The other rater's sheet, DISAGREEMENTS.md, resolutions.json
 * and resolved.json are refused by name, and nothing here imports an engine, the
 * calibration harness or a calibration file. rate.test.mjs asserts all of that.
 *
 * Needs `pnpm build` first, for the implemented rule list, exactly like adjudicate.mjs.
 */
import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANSWERS, RATERS, cellKey, corpusContext, validateSheet } from './adjudicate.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const REAL = join(ROOT, 'corpus', 'real');
const ADJUDICATION = join(REAL, 'adjudication');
const UI = join(import.meta.dirname, 'rate');
const FONTS = join(ROOT, 'apps', 'site', 'src', 'fonts');

/** A request body larger than this is not an answer. One cell with a long note fits easily. */
export const MAX_BODY_BYTES = 16 * 1024;

/** A note longer than this is an essay, and the resolver reading it is a person. */
export const MAX_NOTE_LENGTH = 4_000;

/** How many validation problems one response carries. The count is always exact. */
const MAX_PROBLEMS_SENT = 50;

/**
 * The policy on every snapshot response. Nothing loads from anywhere: no script, no font,
 * no remote image, no frame, no fetch. Inline styles and data URLs render, because they
 * are part of the vendored file. The rater judges the bytes on disk and nothing else.
 */
export const SNAPSHOT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
const SNAPSHOT_POLICY = `${SNAPSHOT_CSP}; form-action 'none'; frame-ancestors 'self'`;

/**
 * The policy on the interface. frame-src 'self' matters beyond the obvious: it governs
 * every navigation inside the iframe too, so following a link in a snapshot cannot load
 * the live page in its place.
 */
const APP_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** The files that would end a rater's independence if they were read before finishing. */
export function forbiddenFor(rater) {
  if (!RATERS.includes(rater)) throw new Error(`rater must be one of ${RATERS.join(', ')}`);
  const other = RATERS.find((r) => r !== rater);
  return Object.freeze([
    `sheet-${String(other)}.json`,
    'DISAGREEMENTS.md',
    'resolutions.json',
    'resolved.json',
  ]);
}

/**
 * Writes a file so that a reader, or a crash, sees the old contents or the new ones and
 * never a mixture: write a sibling temporary file, flush it to disk, then rename it over
 * the target, which is atomic on one filesystem. `beforeRename` exists for the test that
 * simulates a crash at the worst moment.
 *
 * @param {string} file
 * @param {string} text
 * @param {{beforeRename?: (temp: string) => Promise<void> | void}} [hooks]
 */
export async function writeAtomic(file, text, hooks = {}) {
  const temp = join(
    dirname(file),
    `.${basename(file)}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    const handle = await open(temp, 'wx', 0o644);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await hooks.beforeRename?.(temp);
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Reads the request body, refusing anything over the cap before it is buffered. */
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, `request body is over the ${String(MAX_BODY_BYTES)} byte cap`));
      return;
    }
    const chunks = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk) => {
      if (refused) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        refused = true;
        reject(new HttpError(413, `request body is over the ${String(MAX_BODY_BYTES)} byte cap`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!refused) resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function progressOf(cells) {
  let answered = 0;
  let prefilled = 0;
  let overridden = 0;
  for (const cell of cells) {
    if (cell.answer !== null) answered += 1;
    if (cell.prescreened === true && cell.answer === 'inapplicable') prefilled += 1;
    else if (cell.prescreened === true) overridden += 1;
  }
  return {
    total: cells.length,
    answered,
    remaining: cells.length - answered,
    prefilled,
    overridden,
  };
}

/**
 * Builds the rating server without starting it. Every path is injectable so the tests can
 * run against a copy of a worksheet; the defaults are the real corpus.
 *
 * @param {{
 *   rater: string,
 *   sheetFile?: string,
 *   realDir?: string,
 *   actManifest?: string,
 *   uiDir?: string,
 *   fontsDir?: string,
 *   expected?: Set<string>,
 * }} options
 */
export async function createRatingServer(options) {
  const { rater } = options;
  const forbidden = forbiddenFor(rater);
  const realDir = options.realDir ?? REAL;
  const sheetFile = resolve(options.sheetFile ?? join(ADJUDICATION, `sheet-${rater}.json`));
  const actManifestFile = resolve(
    options.actManifest ?? join(ROOT, 'corpus', 'act', 'MANIFEST.json'),
  );
  const uiDir = options.uiDir ?? UI;
  const fontsDir = options.fontsDir ?? FONTS;
  const manifestFile = resolve(realDir, 'MANIFEST.json');

  if (forbidden.includes(basename(sheetFile)) || basename(sheetFile) !== `sheet-${rater}.json`) {
    throw new Error(`rater ${rater} works on sheet-${rater}.json and nothing else`);
  }

  // The allow-list. Every read goes through readAllowed, and readAllowed refuses anything
  // not in this map, so no request can reach a file that is not named here.
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const pages = new Map();
  for (const page of manifest.pages) {
    pages.set(page.id, {
      id: page.id,
      category: page.category,
      title: page.title,
      sha256: page.sha256,
      file: resolve(realDir, page.path),
    });
  }
  const statics = new Map([
    ['/', { file: join(uiDir, 'index.html'), type: 'text/html; charset=utf-8' }],
    ['/app.js', { file: join(uiDir, 'app.js'), type: 'text/javascript; charset=utf-8' }],
    ['/app.css', { file: join(uiDir, 'app.css'), type: 'text/css; charset=utf-8' }],
    ['/fonts/dm-sans.woff2', { file: join(fontsDir, 'dm-sans-latin.woff2'), type: 'font/woff2' }],
    [
      '/fonts/jetbrains-mono.woff2',
      { file: join(fontsDir, 'jetbrains-mono-latin.woff2'), type: 'font/woff2' },
    ],
  ]);
  const allowed = new Set([
    sheetFile,
    manifestFile,
    actManifestFile,
    ...[...pages.values()].map((p) => p.file),
    ...[...statics.values()].map((s) => resolve(s.file)),
  ]);
  for (const file of allowed) {
    if (forbidden.includes(basename(file))) {
      throw new Error(`refusing to start: ${basename(file)} is not readable by rater ${rater}`);
    }
  }

  async function readAllowed(file) {
    const absolute = resolve(file);
    if (!allowed.has(absolute) || forbidden.includes(basename(absolute))) {
      throw new HttpError(403, `${basename(absolute)} is not on this server's allow-list`);
    }
    return readFile(absolute);
  }

  async function readSheet() {
    return JSON.parse((await readAllowed(sheetFile)).toString('utf8'));
  }

  const sheet = await readSheet();
  if (sheet.rater !== rater) {
    throw new Error(`${basename(sheetFile)} says it belongs to rater ${String(sheet.rater)}`);
  }

  const expected = options.expected ?? (await corpusContext()).expected;

  const act = JSON.parse((await readAllowed(actManifestFile)).toString('utf8'));
  const actById = new Map(act.rules.map((r) => [r.id, r]));
  const rules = {};
  for (const cell of sheet.cells) {
    if (Object.hasOwn(rules, cell.rule)) continue;
    const record = actById.get(cell.rule);
    rules[cell.rule] = {
      name: record?.name ?? cell.ruleName,
      ruleType: record?.ruleType ?? null,
      requirements: record?.requirements ?? [],
      // Some front matter carries a trailing comment after a hash. It is not part of the name.
      inputAspects: (record?.inputAspects ?? []).map((a) => String(a).replace(/\s*#.*$/, '')),
    };
  }
  const pageSummaries = Object.fromEntries(
    [...pages.values()].map((p) => [p.id, { category: p.category, title: p.title }]),
  );

  // Writes run one at a time, each re-reading the sheet first, so two quick answers cannot
  // race and a hand edit made while the server runs is not overwritten with stale data.
  let queue = Promise.resolve();
  const serially = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  async function saveAnswer(body) {
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      throw new HttpError(400, 'the body is not JSON');
    }
    const { page, rule, answer } = input ?? {};
    const note = input?.note ?? '';
    if (typeof page !== 'string' || typeof rule !== 'string') {
      throw new HttpError(400, 'page and rule must be strings');
    }
    if (answer !== null && !ANSWERS.includes(answer)) {
      throw new HttpError(400, `answer must be null or one of ${ANSWERS.join(', ')}`);
    }
    if (typeof note !== 'string') throw new HttpError(400, 'note must be a string');
    if (note.length > MAX_NOTE_LENGTH) {
      throw new HttpError(400, `a note is capped at ${String(MAX_NOTE_LENGTH)} characters`);
    }
    return serially(async () => {
      const current = await readSheet();
      const index = current.cells.findIndex((c) => c.page === page && c.rule === rule);
      if (index < 0) throw new HttpError(404, `${cellKey(page, rule)} is not a cell of this sheet`);
      const cell = { ...current.cells[index], answer, note };
      const next = { ...current, cells: current.cells.with(index, cell) };
      const key = cellKey(page, rule);
      // The same validation `adjudicate.mjs validate` runs. A change that would give this
      // cell a problem, such as a failed answer with no note, is refused before it is written.
      const own = validateSheet(next, expected).filter((p) => p.startsWith(`${key}:`));
      if (own.length > 0) throw new HttpError(422, own.join('; '), { problems: own });
      await writeAtomic(sheetFile, `${JSON.stringify(next, null, 2)}\n`);
      const written = await readSheet();
      const problems = validateSheet(written, expected);
      return {
        cell,
        problems: problems.slice(0, MAX_PROBLEMS_SENT),
        problemCount: problems.length,
        progress: progressOf(written.cells),
      };
    });
  }

  async function state() {
    const current = await readSheet();
    const problems = validateSheet(current, expected);
    return {
      rater,
      instructions: current.instructions,
      cells: current.cells,
      rules,
      pages: pageSummaries,
      problems: problems.slice(0, MAX_PROBLEMS_SENT),
      problemCount: problems.length,
      progress: progressOf(current.cells),
    };
  }

  async function readPage(id) {
    const page = pages.get(id);
    if (page === undefined) throw new HttpError(404, 'no such page in the manifest');
    const bytes = await readAllowed(page.file);
    if (sha256(bytes) !== page.sha256) {
      throw new HttpError(500, `${id} does not match its digest in MANIFEST.json`);
    }
    return bytes;
  }

  let origin = '';
  const hosts = new Set();
  const origins = new Set();

  function send(res, status, headers, body) {
    res.writeHead(status, {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...headers,
    });
    res.end(body);
  }

  const json = (res, status, value) =>
    send(
      res,
      status,
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'",
      },
      JSON.stringify(value),
    );

  async function route(req, res) {
    // A page on another origin cannot reach this server through a rebound DNS name,
    // because the Host header would name that origin rather than this loopback address.
    if (!hosts.has(String(req.headers.host))) throw new HttpError(421, 'unexpected Host header');
    const url = new URL(req.url ?? '/', origin);
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'malformed path');
    }
    const lowered = path.toLowerCase();
    const named = forbidden.find((name) => lowered.includes(name.toLowerCase()));
    if (named !== undefined) {
      throw new HttpError(
        403,
        `refused: rater ${rater} may not open ${named} (PROTOCOL.md, Two independent raters)`,
      );
    }

    if (req.method === 'POST' && path === '/api/answer') {
      const requestOrigin = req.headers.origin;
      if (requestOrigin !== undefined && !origins.has(requestOrigin)) {
        throw new HttpError(403, 'cross-origin write refused');
      }
      if (!String(req.headers['content-type']).startsWith('application/json')) {
        throw new HttpError(415, 'send application/json');
      }
      json(res, 200, await saveAnswer(await readBody(req)));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'method not allowed');
    }

    const asset = statics.get(path);
    if (asset !== undefined) {
      send(
        res,
        200,
        { 'Content-Type': asset.type, 'Content-Security-Policy': APP_POLICY },
        await readAllowed(asset.file),
      );
      return;
    }
    if (path === '/api/state') {
      json(res, 200, await state());
      return;
    }
    const pageMatch = /^\/(snapshot|source)\/([a-z]+-\d{2})$/.exec(path);
    if (pageMatch !== null) {
      const [, kind, id] = pageMatch;
      const bytes = await readPage(String(id));
      send(
        res,
        200,
        kind === 'snapshot'
          ? { 'Content-Type': 'text/html', 'Content-Security-Policy': SNAPSHOT_POLICY }
          : {
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Security-Policy': "default-src 'none'",
            },
        bytes,
      );
      return;
    }
    throw new HttpError(404, 'not found');
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.setHeader('Connection', 'close');
      json(res, status, { error: message, ...(error instanceof HttpError ? error.extra : {}) });
      if (status === 413) res.on('finish', () => req.destroy());
    });
  });

  return {
    server,
    sheetFile,
    /** Listens on 127.0.0.1 only. Port 0 asks the operating system for a free one. */
    listen(port = 0) {
      return new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          const address = server.address();
          const actual = typeof address === 'object' && address !== null ? address.port : port;
          origin = `http://127.0.0.1:${String(actual)}`;
          hosts.clear();
          hosts.add(`127.0.0.1:${String(actual)}`);
          hosts.add(`localhost:${String(actual)}`);
          origins.clear();
          for (const host of hosts) origins.add(`http://${host}`);
          resolveListen(`${origin}/`);
        });
      });
    },
    close() {
      return new Promise((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      });
    },
  };
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

async function main(argv) {
  const rater = argument(argv, '--rater');
  const portArgument = argument(argv, '--port');
  const port = portArgument === undefined ? 0 : Number(portArgument);
  if (
    rater === undefined ||
    !RATERS.includes(rater) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65_535
  ) {
    console.error('usage: node scripts/rate.mjs --rater A|B [--port N]');
    process.exitCode = 2;
    return;
  }
  let rating;
  try {
    rating = await createRatingServer({ rater });
  } catch (error) {
    console.error(`rate: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  const url = await rating.listen(port);
  console.log(`Rating sheet-${rater}.json for rater ${rater} at ${url}`);
  console.log('Every answer is saved to the worksheet as you give it. Stop with Ctrl+C.');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
