#!/usr/bin/env node
/**
 * Proves the vendored real-page corpora are unmodified. No network, no dependencies.
 *
 * corpus/real is the second ground truth: twenty-five pages snapshotted from the public
 * web, against which every engine is measured separately from the ACT test cases.
 * corpus/heldout is the third: twenty-five more pages from different sites, whose ground
 * truth was committed before any rule change made after the error analysis on corpus/real
 * was measured on it. That is only worth something if the two share no site, so this
 * script also refuses a held-out page from a site corpus/real already uses. The
 * same argument applies as for corpus/act. A page that can be edited is a question that
 * can be changed until the answer is convenient, so every page carries a SHA-256 and a
 * byte count in MANIFEST.json and this script recomputes all of them.
 *
 * It also checks what a snapshot promises: no script element and no inline event handler
 * survived, the provenance comment is still the first thing after the doctype and still
 * names the URL the manifest names, and every page's licence and attribution are in
 * SOURCES.json and NOTICE.md, because the licences require the attribution to travel.
 *
 * Run with bare `node`, as the CI corpus job does. That job installs nothing.
 *
 * Usage: node scripts/verify-real-corpus.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { hygieneProblems } from './lib/snapshot-hygiene.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * The totals as snapshotted, corpus/real on 2026-10-12 and corpus/heldout on the date its
 * manifest records. Pinned here as well as recorded in each manifest, so a page added or
 * dropped is a diff to this constant that someone reviews, rather than a manifest
 * regenerated to match whatever is on disk.
 */
const CORPORA = [
  { name: 'real', expected: { pages: 25, bytes: 13_257_475 } },
  { name: 'heldout', expected: { pages: 25, bytes: 12_563_683 } },
];

/** Forty problems are enough to act on. The rest are counted. */
const MAX_REPORTED = 40;

const problems = [];
const note = (message) => problems.push(message);

/** The site a host belongs to: its last two labels, or three under a short country suffix. */
function siteOf(host) {
  const labels = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  const last = labels.at(-1) ?? '';
  const second = labels.at(-2) ?? '';
  const keep = last.length === 2 && second.length <= 3 ? 3 : 2;
  return labels.slice(-keep).join('.');
}

function readJson(corpus, name) {
  const file = join(ROOT, 'corpus', corpus, name);
  if (!existsSync(file)) {
    note(`corpus/${corpus}/${name} is missing.`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    note(
      `corpus/${corpus}/${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Checks one corpus and returns the sites its pages come from. */
function verifyCorpus(name, expected) {
  const CORPUS = join(ROOT, 'corpus', name);
  const sites = new Set();
  const reported = problems.length;
  const manifest = readJson(name, 'MANIFEST.json');
  const sources = readJson(name, 'SOURCES.json');
  const notice = existsSync(join(CORPUS, 'NOTICE.md'))
    ? readFileSync(join(CORPUS, 'NOTICE.md'), 'utf8')
    : (note(`corpus/${name}/NOTICE.md is missing. The licences require attribution to travel.`),
      '');

  if (manifest !== null && sources !== null) {
    const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
    const sourceById = new Map(
      (Array.isArray(sources.pages) ? sources.pages : []).map((s) => [s.id, s]),
    );

    const listed = new Set();
    let bytes = 0;
    let scriptsRemoved = 0;
    const categories = {};

    for (const page of pages) {
      const id = String(page.id);
      listed.add(page.path);
      for (const url of [page.url, page.landedUrl].filter((u) => typeof u === 'string')) {
        sites.add(siteOf(new URL(url).hostname));
      }
      categories[page.category] = (categories[page.category] ?? 0) + 1;
      scriptsRemoved += page.scriptsRemoved;

      const source = sourceById.get(id);
      if (source === undefined) {
        note(`${name}/${id}: in MANIFEST.json but not in SOURCES.json.`);
      } else {
        if (source.url !== page.url)
          note(`${name}/${id}: MANIFEST and SOURCES disagree on the URL.`);
        if (
          source.licence?.name !== page.licence?.name ||
          source.licence?.url !== page.licence?.url
        ) {
          note(`${name}/${id}: MANIFEST and SOURCES disagree on the licence.`);
        }
        if (typeof source.licence?.attribution !== 'string' || source.licence.attribution === '') {
          note(`${name}/${id}: SOURCES.json has no attribution.`);
        }
      }
      if (!notice.includes(`\`${id}\``))
        note(`${name}/${id}: NOTICE.md does not carry its attribution.`);

      const file = join(CORPUS, ...String(page.path).split('/'));
      if (!existsSync(file)) {
        note(`corpus/${name}/${page.path}: listed in MANIFEST but not on disk.`);
        continue;
      }
      const data = readFileSync(file);
      bytes += data.length;
      const actual = createHash('sha256').update(data).digest('hex');
      if (actual !== page.sha256) {
        note(
          `${page.path}: digest mismatch. Expected ${String(page.sha256).slice(0, 12)}, got ${actual.slice(0, 12)}.`,
        );
      }
      if (data.length !== page.bytes) {
        note(
          `corpus/${name}/${page.path}: ${String(data.length)} bytes, MANIFEST says ${String(page.bytes)}.`,
        );
      }
      const html = data.toString('utf8');
      for (const p of hygieneProblems(`${name}/${id}`, html)) note(p);
      const provenance = /^<!-- marlo-snapshot: url (\S+); retrieved (\d{4}-\d{2}-\d{2});/m.exec(
        html,
      );
      if (provenance !== null) {
        if (provenance[1] !== page.url)
          note(`${name}/${id}: the provenance comment names a different URL.`);
        if (provenance[2] !== page.retrieved)
          note(`${name}/${id}: the provenance comment names a different date.`);
      }
    }

    // The other direction: anything on disk the manifest does not know about. An unlisted
    // page is how a hand-made document would get counted as a real one.
    const pagesDir = join(CORPUS, 'pages');
    const onDisk = existsSync(pagesDir) ? walk(pagesDir) : [];
    for (const file of onDisk) {
      const rel = relative(CORPUS, file).split(sep).join('/');
      if (!listed.has(rel))
        note(
          `corpus/${name}/${rel}: on disk but not in MANIFEST. Nothing unlisted may live in the corpus.`,
        );
    }
    for (const id of sourceById.keys()) {
      if (!pages.some((p) => p.id === id))
        note(`${name}/${id}: in SOURCES.json but not in MANIFEST.json.`);
    }

    // Totals: the manifest against itself, then against the pinned figures.
    const totals = manifest.totals ?? {};
    if (totals.pages !== pages.length) {
      note(
        `corpus/${name}/MANIFEST lists ${String(pages.length)} pages but claims ${String(totals.pages)}.`,
      );
    }
    if (totals.bytes !== bytes)
      note(
        `corpus/${name}/MANIFEST claims ${String(totals.bytes)} bytes, the files total ${String(bytes)}.`,
      );
    if (totals.scriptsRemoved !== scriptsRemoved) {
      note(
        `MANIFEST claims ${String(totals.scriptsRemoved)} scripts removed, the pages sum to ${String(scriptsRemoved)}.`,
      );
    }
    const claimedCategories = JSON.stringify(Object.entries(totals.categories ?? {}).sort());
    if (claimedCategories !== JSON.stringify(Object.entries(categories).sort())) {
      note(`corpus/${name}/MANIFEST category totals do not match the pages it lists.`);
    }
    if (pages.length !== expected.pages || bytes !== expected.bytes) {
      note(
        `corpus/${name}: ${String(pages.length)} pages and ${String(bytes)} bytes, expected ${String(expected.pages)} and ` +
          `${String(expected.bytes)}. If the corpus really changed, update CORPORA here in the same commit.`,
      );
    }

    if (problems.length === reported) {
      console.log(
        `corpus:verify: ${String(pages.length)} ${name} pages in ${String(Object.keys(categories).length)} ` +
          `categories, ${String(Math.round(bytes / 1024))} KiB, all digests match. ` +
          `Retrieved ${String(manifest.retrieved)}.`,
      );
    }
  }
  return sites;
}

const sitesByCorpus = new Map(CORPORA.map((c) => [c.name, verifyCorpus(c.name, c.expected)]));

// A held-out page from a site the analysed pages already use would let a fix written for
// that site's markup score on the held-out set too.
for (const site of sitesByCorpus.get('heldout') ?? []) {
  if (sitesByCorpus.get('real')?.has(site)) {
    note(
      `corpus/heldout uses ${site}, which corpus/real already uses. The two must share no site.`,
    );
  }
}

if (problems.length > 0) {
  console.error(
    `\ncorpus:verify (real-page corpora) failed with ${String(problems.length)} problems\n`,
  );
  for (const p of problems.slice(0, MAX_REPORTED)) console.error(`  ${p}`);
  if (problems.length > MAX_REPORTED)
    console.error(`  ...and ${String(problems.length - MAX_REPORTED)} more.`);
  console.error(
    '\nA real page that can be edited means an inconvenient result can be made convenient',
  );
  console.error(
    'by changing the question. Re-snapshot with scripts/snapshot-real-pages.mjs instead.\n',
  );
  process.exitCode = 1;
}
