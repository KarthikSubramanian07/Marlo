import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSheet, corpusContext, validateSheet } from './adjudicate.mjs';
import {
  MAX_BODY_BYTES,
  SNAPSHOT_CSP,
  createRatingServer,
  forbiddenFor,
  writeAtomic,
} from './rate.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const REAL = join(ROOT, 'corpus', 'real');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'corpus', 'real', 'MANIFEST.json'), 'utf8'));

/** A raw HTTP request, so a path reaches the server exactly as written, dots and all. */
function send(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method, path, headers: { ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolveRequest({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const postAnswer = (port, answer) =>
  send(port, {
    method: 'POST',
    path: '/api/answer',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(answer),
  });

/**
 * A fresh, unanswered sheet for one rater in a private directory, built exactly as
 * `adjudicate.mjs sheet` builds one, so no test writes into the corpus and the tests do
 * not depend on whether the committed sheets have been answered.
 */
function copySheet(rater) {
  const dir = mkdtempSync(join(tmpdir(), `marlo-rate-${rater}-`));
  const file = join(dir, `sheet-${rater}.json`);
  const sheet = buildSheet(rater, context.pages, context.rules, (p) =>
    readFileSync(join(REAL, p.path), 'utf8'),
  );
  writeFileSync(file, `${JSON.stringify(sheet, null, 2)}\n`, 'utf8');
  return { dir, file };
}

let context;
let expected;
const servers = [];
const dirs = [];

async function start(rater) {
  const { dir, file } = copySheet(rater);
  dirs.push(dir);
  const rating = await createRatingServer({ rater, sheetFile: file, expected });
  const url = await rating.listen(0);
  servers.push(rating);
  return { rating, file, dir, port: Number(new URL(url).port) };
}

beforeAll(async () => {
  context = await corpusContext();
  expected = context.expected;
});

afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('saving through the HTTP API', () => {
  it('writes answers the validate step accepts, in the same format and order', async () => {
    const { file, port } = await start('A');
    const before = JSON.parse(readFileSync(file, 'utf8'));
    const open = before.cells.filter((c) => c.answer === null);
    const prefilled = before.cells.find((c) => c.prescreened);

    const answers = [
      { page: open[0].page, rule: open[0].rule, answer: 'passed', note: '' },
      {
        page: open[1].page,
        rule: open[1].rule,
        answer: 'failed',
        note: 'The search input has no label.',
      },
      {
        page: open[2].page,
        rule: open[2].rule,
        answer: 'cantTell',
        note: 'Depends on what the author meant.',
      },
      { page: open[3].page, rule: open[3].rule, answer: 'inapplicable', note: '' },
      // Overriding the pre-screen is allowed, and the cell stays marked as pre-screened.
      {
        page: prefilled.page,
        rule: prefilled.rule,
        answer: 'failed',
        note: 'There is a field in a template.',
      },
    ];
    for (const answer of answers) {
      const response = await postAnswer(port, answer);
      expect(response.status, response.body.toString()).toBe(200);
      const body = JSON.parse(response.body.toString());
      expect(body.cell).toMatchObject({ answer: answer.answer, note: answer.note });
      expect(body.problemCount).toBe(0);
    }

    const text = readFileSync(file, 'utf8');
    const after = JSON.parse(text);
    expect(validateSheet(after, expected)).toEqual([]);
    // Byte format identical to what adjudicate.mjs writes, and the seeded order untouched.
    expect(text).toBe(`${JSON.stringify(after, null, 2)}\n`);
    expect(after.cells.map((c) => `${c.page}/${c.rule}`)).toEqual(
      before.cells.map((c) => `${c.page}/${c.rule}`),
    );
    const overridden = after.cells.find(
      (c) => c.page === prefilled.page && c.rule === prefilled.rule,
    );
    expect(overridden).toMatchObject({ prescreened: true, answer: 'failed' });
    const changed = after.cells.filter(
      (c, i) => JSON.stringify(c) !== JSON.stringify(before.cells[i]),
    );
    expect(changed).toHaveLength(answers.length);
  });

  it("records the answers as a person's, and will not continue a sheet a model answered", async () => {
    const { file, port } = await start('B');
    const cell = JSON.parse(readFileSync(file, 'utf8')).cells.find((c) => c.answer === null);
    const saved = await postAnswer(port, { page: cell.page, rule: cell.rule, answer: 'passed' });
    expect(saved.status, saved.body.toString()).toBe(200);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      raterKind: 'person',
      raterModel: null,
    });

    const modelSheet = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(
      file,
      `${JSON.stringify({ ...modelSheet, raterKind: 'model', raterModel: 'claude-sonnet-5-5' }, null, 2)}\n`,
    );
    const before = readFileSync(file, 'utf8');
    const refused = await postAnswer(port, {
      page: cell.page,
      rule: cell.rule,
      answer: 'failed',
      note: 'x',
    });
    expect(refused.status).toBe(409);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('refuses a failed or cantTell answer with no note, and leaves the sheet alone', async () => {
    const { file, port } = await start('A');
    const before = readFileSync(file, 'utf8');
    const cell = JSON.parse(before).cells.find((c) => c.answer === null);
    for (const answer of ['failed', 'cantTell']) {
      const response = await postAnswer(port, {
        page: cell.page,
        rule: cell.rule,
        answer,
        note: '  ',
      });
      expect(response.status).toBe(422);
      expect(JSON.parse(response.body.toString()).problems[0]).toMatch(/needs a note/);
    }
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('refuses answers that are not outcomes, cells that do not exist, and oversized notes', async () => {
    const { port } = await start('A');
    const bad = [
      { page: 'shop-01', rule: 'cae760', answer: 'maybe', note: '' },
      { page: 'shop-99', rule: 'cae760', answer: 'passed', note: '' },
      { page: 'shop-01', rule: 'cae760', answer: 'passed', note: 'x'.repeat(4_001) },
      { page: 'shop-01', rule: 'cae760', answer: 'passed', note: 7 },
    ];
    const statuses = [];
    for (const answer of bad) statuses.push((await postAnswer(port, answer)).status);
    expect(statuses).toEqual([400, 404, 400, 400]);
    expect(
      (
        await send(port, {
          method: 'POST',
          path: '/api/answer',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(port, {
          method: 'POST',
          path: '/api/answer',
          headers: { 'Content-Type': 'text/plain' },
          body: '{}',
        })
      ).status,
    ).toBe(415);
  });

  it('caps the request body', async () => {
    const { port } = await start('A');
    const body = JSON.stringify({
      page: 'shop-01',
      rule: 'cae760',
      answer: 'passed',
      note: 'x'.repeat(MAX_BODY_BYTES),
    });
    const response = await postAnswer(port, JSON.parse(body));
    expect(response.status).toBe(413);
  });

  it('serves the state of this sheet with progress and no problems', async () => {
    const { port } = await start('A');
    const response = await send(port, { path: '/api/state' });
    expect(response.status).toBe(200);
    const state = JSON.parse(response.body.toString());
    expect(state.rater).toBe('A');
    expect(state.problemCount).toBe(0);
    expect(state.progress.total).toBe(expected.size);
    expect(state.progress.prefilled).toBe(state.cells.filter((c) => c.prescreened).length);
    expect(Object.keys(state.rules).length).toBe(expected.size / MANIFEST.pages.length);
  });
});

describe('atomic writes', () => {
  it('replaces the sheet by rename and leaves no temporary file behind', async () => {
    const { file, dir, port } = await start('A');
    const inodeBefore = statSync(file).ino;
    const cell = JSON.parse(readFileSync(file, 'utf8')).cells.find((c) => c.answer === null);
    expect(
      (await postAnswer(port, { page: cell.page, rule: cell.rule, answer: 'passed', note: '' }))
        .status,
    ).toBe(200);
    // A new inode means the file was renamed into place rather than rewritten in place,
    // which is the property that keeps a half-written sheet from ever existing.
    expect(statSync(file).ino).not.toBe(inodeBefore);
    expect(readdirSync(dir)).toEqual(['sheet-A.json']);
  });

  it('keeps the old sheet intact when the process dies between write and rename', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'marlo-atomic-'));
    dirs.push(dir);
    const file = join(dir, 'sheet-A.json');
    writeFileSync(file, '{"old": true}\n');
    let temp = '';
    await expect(
      writeAtomic(file, '{"new": true}\n', {
        beforeRename: (path) => {
          temp = path;
          expect(readFileSync(path, 'utf8')).toBe('{"new": true}\n');
          throw new Error('simulated crash');
        },
      }),
    ).rejects.toThrow('simulated crash');
    expect(readFileSync(file, 'utf8')).toBe('{"old": true}\n');
    expect(existsSync(temp)).toBe(false);
    expect(readdirSync(dir)).toEqual(['sheet-A.json']);

    await writeAtomic(file, '{"new": true}\n');
    expect(readFileSync(file, 'utf8')).toBe('{"new": true}\n');
  });

  it('serialises concurrent saves so none is lost', async () => {
    const { file, port } = await start('A');
    const cells = JSON.parse(readFileSync(file, 'utf8'))
      .cells.filter((c) => c.answer === null)
      .slice(0, 12);
    const responses = await Promise.all(
      cells.map((c) =>
        postAnswer(port, { page: c.page, rule: c.rule, answer: 'inapplicable', note: '' }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(cells.map(() => 200));
    const after = JSON.parse(readFileSync(file, 'utf8'));
    for (const c of cells) {
      expect(after.cells.find((x) => x.page === c.page && x.rule === c.rule).answer).toBe(
        'inapplicable',
      );
    }
  });
});

describe('what the server will and will not serve', () => {
  it('serves the snapshot byte for byte under a policy that blocks every network load', async () => {
    const { port } = await start('A');
    const page = MANIFEST.pages[0];
    const response = await send(port, { path: `/snapshot/${page.id}` });
    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toMatch(
      new RegExp(`^${SNAPSHOT_CSP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(;|$)`),
    );
    expect(SNAPSHOT_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(createHash('sha256').update(response.body).digest('hex')).toBe(page.sha256);

    const source = await send(port, { path: `/source/${page.id}` });
    expect(source.headers['content-type']).toMatch(/^text\/plain/);
    expect(createHash('sha256').update(source.body).digest('hex')).toBe(page.sha256);
  });

  it('frames snapshots in a sandbox without scripts, under an interface policy that keeps them local', async () => {
    const { port } = await start('A');
    const index = await send(port, { path: '/' });
    const html = index.body.toString();
    expect(html).toMatch(/<iframe\s+id="snapshot"\s+sandbox=""/);
    expect(html).not.toMatch(/allow-scripts/);
    const policy = String(index.headers['content-security-policy']);
    expect(policy).toContain("frame-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
  });

  it.each([
    '/../../package.json',
    '/snapshot/../../package.json',
    '/snapshot/..%2F..%2FMANIFEST.json',
    '/%2e%2e/%2e%2e/package.json',
    '/source/shop-01/../../../../etc/passwd',
    '/snapshot/shop-01%00.html',
    '/scripts/rate.mjs',
    '/corpus/real/MANIFEST.json',
    '/app.js/../../rate.mjs',
    '/calibration/table.json',
    '/packages/engines/src/index.ts',
    '/snapshot/shop-1',
    '/%E0%A4%A',
  ])('refuses %s', async (path) => {
    const { port } = await start('A');
    const response = await send(port, { path });
    expect([400, 403, 404]).toContain(response.status);
    expect(response.body.toString()).not.toMatch(/"name": "marlo"|root:|IMPLEMENTED_RULES/);
  });

  it.each([
    ['A', '/sheet-B.json'],
    ['A', '/corpus/real/adjudication/sheet-B.json'],
    ['A', '/snapshot/sheet-B.json'],
    ['A', '/DISAGREEMENTS.md'],
    ['A', '/resolutions.json'],
    ['A', '/resolved.json'],
    ['A', '/api/../resolved.json'],
    ['B', '/sheet-A.json'],
    ['B', '/disagreements.md'],
    ['B', '/%73heet-A.json'],
  ])('rater %s is refused %s by name', async (rater, path) => {
    const { port } = await start(rater);
    const response = await send(port, { path });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body.toString()).error).toMatch(/refused|allow-list/);
  });

  it('names the other sheet and the adjudication outputs as forbidden, for each rater', () => {
    expect(forbiddenFor('A')).toEqual([
      'sheet-B.json',
      'DISAGREEMENTS.md',
      'resolutions.json',
      'resolved.json',
    ]);
    expect(forbiddenFor('B')).toEqual([
      'sheet-A.json',
      'DISAGREEMENTS.md',
      'resolutions.json',
      'resolved.json',
    ]);
    expect(() => forbiddenFor('C')).toThrow();
  });

  it("will not start a rater's server on the other rater's sheet", async () => {
    const { file } = copySheet('B');
    dirs.push(resolve(file, '..'));
    await expect(createRatingServer({ rater: 'A', sheetFile: file, expected })).rejects.toThrow(
      /sheet-A.json and nothing else/,
    );
  });

  it('refuses a request whose Host header names another origin, and a cross-origin write', async () => {
    const { port } = await start('A');
    expect(
      (await send(port, { path: '/api/state', headers: { Host: 'attacker.example' } })).status,
    ).toBe(421);
    const cross = await send(port, {
      method: 'POST',
      path: '/api/answer',
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      body: '{}',
    });
    expect(cross.status).toBe(403);
    expect((await send(port, { method: 'DELETE', path: '/api/state' })).status).toBe(405);
  });
});

describe('independence from every engine and every published number', () => {
  const files = ['scripts/rate.mjs', 'scripts/adjudicate.mjs', 'scripts/rate/app.js'];
  const forbiddenImport =
    /@trymarlo\/(?:engines|calibrate)\b|packages\/(?:engines|calibrate)\b|calibration\//;

  /** Every module specifier in a file: static imports, re-exports and dynamic imports. */
  function specifiers(file) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    const found = [];
    for (const match of text.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g,
    )) {
      found.push(match[1]);
    }
    return found;
  }

  it.each(files)('%s imports nothing from an engine, the harness or calibration/', (file) => {
    const found = specifiers(file);
    expect(found.filter((s) => forbiddenImport.test(s))).toEqual([]);
  });

  it('reaches no engine or harness through the workspace packages it does import', () => {
    const seen = new Set();
    const queue = files.flatMap(specifiers).filter((s) => s.startsWith('@trymarlo/'));
    expect(queue.length).toBeGreaterThan(0);
    while (queue.length > 0) {
      const name = String(queue.shift());
      if (seen.has(name)) continue;
      seen.add(name);
      const pkg = JSON.parse(
        readFileSync(
          join(ROOT, 'packages', name.slice('@trymarlo/'.length), 'package.json'),
          'utf8',
        ),
      );
      queue.push(...Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith('@trymarlo/')));
    }
    expect([...seen].sort()).not.toContain('@trymarlo/engines');
    expect([...seen].sort()).not.toContain('@trymarlo/calibrate');
  });

  it('reads no file outside its allow-list, so calibration output cannot reach the page', () => {
    const text = readFileSync(join(ROOT, 'scripts', 'rate.mjs'), 'utf8');
    expect(text).not.toMatch(/['"`]calibration['"`/]/);
    // One read path, guarded by the allow-list, and no request path joined onto the disk.
    expect(text.match(/\breadFile\(/g)).toHaveLength(2);
    expect(text).not.toMatch(/join\([^)]*(?:req|url|path)\b[^)]*\)/);
  });
});
