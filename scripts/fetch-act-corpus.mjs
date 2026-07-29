#!/usr/bin/env node
/**
 * Vendors the ACT-Rules Community corpus into corpus/act/.
 *
 * Two reasons this is a copy rather than a fetch at test time, both in
 * DECISIONS.md D-012. CI has to be green with no network, which is also the only
 * way the offline story is true rather than claimed. And a calibration number
 * that silently changes because an upstream file changed is not a calibration
 * number, it is a reading: regeneration should be a deliberate commit with a
 * diff someone looks at.
 *
 * The corpus is under the W3C Software and Document Licence, which permits
 * copying and redistribution provided the notice travels with it and any
 * modification is marked. This script writes NOTICE.md and a digest manifest, so
 * verify-act-corpus.mjs can prove nothing was modified after the fact.
 *
 * Usage:
 *   node scripts/fetch-act-corpus.mjs            fetch and write corpus/act/
 *   node scripts/fetch-act-corpus.mjs --dry-run  report what would change
 *
 * Needs network. Everything else in this repository does not.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'corpus', 'act');
const INDEX_URL = 'https://act-rules.github.io/testcases.json';
const RULES_API = 'https://api.github.com/repos/act-rules/act-rules.github.io/contents/_rules';

const dryRun = process.argv.includes('--dry-run');

// 1134 requests to one static host. Eight in flight is enough to finish in about
// a minute and low enough not to earn a 503, which twelve did.
const CONCURRENCY = 8;
const ATTEMPTS = 5;

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries on transient failures with exponential backoff. The first run of this
 * script died on a single 503 partway through 1134 requests, having already spent
 * the network time. A 4xx other than 429 is not retried: it means the URL is
 * wrong, and retrying a wrong URL five times is just slower.
 */
async function getText(url) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'marlo-corpus-fetch (+https://trymarlo.pages.dev)' },
      });
      if (res.ok) return await res.text();

      const retryable = res.status === 429 || res.status >= 500;
      lastError = new Error(`${String(res.status)} ${res.statusText} for ${url}`);
      if (!retryable) throw lastError;
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /^4\d\d /.test(error.message)) throw error;
    }
    if (attempt < ATTEMPTS) await sleep(400 * 2 ** (attempt - 1));
  }
  throw lastError;
}

async function getJson(url) {
  return JSON.parse(await getText(url));
}

/** Runs `task` over `items` with bounded concurrency, preserving order. */
async function mapLimit(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await task(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Reads the YAML front matter of an ACT rule. Deliberately narrow: it handles the
 * shape these files actually have rather than YAML in general, because a general
 * parser would accept shapes this pipeline cannot use and fail later, further
 * from the cause.
 */
function parseRuleFrontMatter(markdown, file) {
  const m = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (!m) throw new Error(`${file}: no front matter`);
  const fm = m[1];

  const id = /^id:\s*(\S+)/m.exec(fm)?.[1];
  const name = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim();
  const ruleType = /^rule_type:\s*(\S+)/m.exec(fm)?.[1];
  if (!id || !name || !ruleType) throw new Error(`${file}: missing id, name or rule_type`);

  // accessibility_requirements is a nested map. Its keys are what matter:
  // wcag20:1.3.1, wcag21:1.4.13, wcag-technique:H25, aria12:someterm.
  const requirements = [];
  const block = /^accessibility_requirements:\s*\n([\s\S]*?)(?=^\S|\Z)/m.exec(fm)?.[1] ?? '';
  for (const line of block.split('\n')) {
    const key = /^ {2}([\w-]+:[\w.-]+):/.exec(line)?.[1];
    if (key !== undefined) requirements.push(key);
  }

  const inputAspects = [];
  const aspects = /^input_aspects:\s*\n([\s\S]*?)(?=^\S|\Z)/m.exec(fm)?.[1] ?? '';
  for (const line of aspects.split('\n')) {
    const a = /^\s+-\s+(.+?)\s*$/.exec(line)?.[1];
    if (a !== undefined) inputAspects.push(a);
  }

  return { id, name, ruleType, requirements, inputAspects };
}

console.log('Fetching the ACT rule index and test case index.');
const [index, ruleFiles] = await Promise.all([getJson(INDEX_URL), getJson(RULES_API)]);

const testcases = index.testcases ?? [];
if (testcases.length === 0) throw new Error('testcases.json returned nothing');

const ruleMarkdownNames = ruleFiles.filter((e) => e.type === 'file' && e.name.endsWith('.md'));
console.log(
  `  ${String(ruleMarkdownNames.length)} rules, ${String(testcases.length)} test cases upstream.`,
);

console.log('Fetching rule front matter.');
const rules = await mapLimit(ruleMarkdownNames, CONCURRENCY, async (entry) => {
  // download_url from the contents API rather than a raw.githubusercontent URL
  // built by hand. The default branch of that repository is not `main`, and
  // guessing it produced 404s on the first attempt.
  if (typeof entry.download_url !== 'string') {
    throw new Error(`${entry.name}: contents API gave no download_url`);
  }
  const md = await getText(entry.download_url);
  return { file: entry.name, ...parseRuleFrontMatter(md, entry.name) };
});
rules.sort((a, b) => a.id.localeCompare(b.id));

console.log(`Fetching ${String(testcases.length)} test case documents.`);
let fetched = 0;
const documents = await mapLimit(testcases, CONCURRENCY, async (tc) => {
  const html = await getText(tc.url);
  fetched += 1;
  if (fetched % 200 === 0) console.log(`  ${String(fetched)}/${String(testcases.length)}`);
  return {
    ruleId: tc.ruleId,
    testcaseId: tc.testcaseId,
    title: tc.testcaseTitle,
    expected: tc.expected,
    url: tc.url,
    relativePath: `testcases/${tc.ruleId}/${tc.testcaseId}.html`,
    html,
  };
});

// Sorted so the manifest and the on-disk layout are reproducible. An unstable
// ordering would make every regeneration look like a change.
documents.sort((a, b) =>
  a.ruleId === b.ruleId
    ? a.testcaseId.localeCompare(b.testcaseId)
    : a.ruleId.localeCompare(b.ruleId),
);

const byRule = new Map();
for (const doc of documents) {
  const bucket = byRule.get(doc.ruleId) ?? { passed: 0, failed: 0, inapplicable: 0 };
  bucket[doc.expected] += 1;
  byRule.set(doc.ruleId, bucket);
}

const counts = { passed: 0, failed: 0, inapplicable: 0 };
for (const doc of documents) counts[doc.expected] += 1;

const manifest = {
  source: {
    name: index.name,
    website: index.website,
    license: index.license,
    indexUrl: INDEX_URL,
    rulesRepository: 'https://github.com/act-rules/act-rules.github.io',
  },
  retrieved: new Date().toISOString().slice(0, 10),
  totals: {
    rules: rules.length,
    rulesWithTestCases: byRule.size,
    testCases: documents.length,
    expected: counts,
  },
  rules: rules.map((r) => ({
    id: r.id,
    name: r.name,
    ruleType: r.ruleType,
    requirements: r.requirements,
    inputAspects: r.inputAspects,
    testCases: byRule.get(r.id) ?? { passed: 0, failed: 0, inapplicable: 0 },
  })),
  testCases: documents.map((d) => ({
    ruleId: d.ruleId,
    testcaseId: d.testcaseId,
    title: d.title,
    expected: d.expected,
    path: d.relativePath,
    sha256: sha256(d.html),
  })),
};

if (dryRun) {
  console.log('\n--dry-run, nothing written.');
  console.log(JSON.stringify(manifest.totals, null, 2));
  process.exit(0);
}

console.log('Writing corpus/act/.');
rmSync(join(OUT, 'testcases'), { recursive: true, force: true });
for (const doc of documents) {
  const target = join(OUT, doc.relativePath);
  mkdirSync(dirname(target), { recursive: true });
  // No trailing newline added and no reformatting. The digest in the manifest is
  // of exactly these bytes, and touching them would be an unmarked modification.
  writeFileSync(target, doc.html, 'utf8');
}

writeFileSync(join(OUT, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

writeFileSync(
  join(OUT, 'NOTICE.md'),
  `# Notice

The files under this directory are a verbatim copy of the ACT-Rules Community
test cases, retrieved from ${INDEX_URL} on ${manifest.retrieved}.

They are **not** Marlo's work. They are vendored so that Marlo's calibration
numbers are reproducible offline and cannot change without a reviewed commit.
Nothing here is modified. \`MANIFEST.json\` records a SHA-256 digest of every
file and \`pnpm corpus:verify\` fails if any byte differs, which means a local
modification cannot go unmarked.

This directory includes material copied from the ACT-Rules Community rules and
test cases, <${index.website}>. Copyright the contributors to the ACT-Rules
Community Group. Licensed under the W3C Software and Document Licence.

## W3C Software And Document Notice And License

This work is being provided by the copyright holders under the following
license.

### License

By obtaining and/or copying this work, you (the licensee) agree that you have
read, understood, and will comply with the following terms and conditions.

Permission to copy, modify, and distribute this work, with or without
modification, for any purpose and without fee or royalty is hereby granted,
provided that you include the following on ALL copies of the work or portions
thereof, including modifications:

- The full text of this NOTICE in a location viewable to users of the
  redistributed or derivative work.
- Any pre-existing intellectual property disclaimers, notices, or terms and
  conditions. If none exist, the W3C Software and Document Short Notice should be
  included.
- Notice of any changes or modifications, through a copyright statement on the
  new code or document such as "This software or document includes material
  copied from or derived from [title and URI of the W3C document]. Copyright
  © [YEAR] W3C® (MIT, ERCIM, Keio, Beihang)."

### Disclaimer

This work is provided "AS IS," and copyright holders make no representations or
warranties, express or implied, including but not limited to, warranties of
merchantability or fitness for any particular purpose or that the use of the
software or document will not infringe any third party patents, copyrights,
trademarks or other rights.

Copyright holders will not be liable for any direct, indirect, special or
consequential damages arising out of any use of the software or document.

The name and trademarks of copyright holders may NOT be used in advertising or
publicity pertaining to the work without specific, written prior permission.
Title to copyright in this work will at all times remain with copyright holders.

## Regenerating

\`\`\`
pnpm corpus:fetch     # needs network, rewrites this directory
pnpm corpus:verify    # no network, proves nothing was modified
\`\`\`

A regeneration is a deliberate commit. The diff shows what upstream changed, and
the calibration table is expected to move with it.
`,
  'utf8',
);

console.log(`\nWrote ${String(documents.length)} test cases across ${String(byRule.size)} rules.`);
console.log(`Rules with front matter: ${String(rules.length)}`);
console.log(JSON.stringify(manifest.totals.expected, null, 0));
