#!/usr/bin/env node
/**
 * The tooling for human ground truth on the real-page corpus. The protocol it implements
 * is corpus/real/adjudication/PROTOCOL.md; read that first.
 *
 * The unit is one page by one ACT rule, for every rule Marlo implements. Two raters each
 * fill in a worksheet without seeing the other's, an agreement step measures how often
 * they agreed and lists every cell where they did not, and a resolve step merges the
 * agreements and the written resolutions into the ground truth the calibration harness
 * grades against. Nothing here runs an engine, and no engine output ever reaches a
 * worksheet, because a rater who can see what a tool said is no longer independent of it.
 *
 * Usage:
 *   node scripts/adjudicate.mjs sheet --rater A|B   write that rater's empty worksheet
 *   node scripts/adjudicate.mjs validate            check both worksheets and resolutions
 *   node scripts/adjudicate.mjs agreement           kappa and percent agreement, and write
 *                                                   DISAGREEMENTS.md
 *   node scripts/adjudicate.mjs resolve             write resolved.json, refusing any
 *                                                   disagreement without a resolution
 *
 * Needs `pnpm build` first, for the implemented rule list and the rule names.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const REAL = join(ROOT, 'corpus', 'real');
const ADJUDICATION = join(REAL, 'adjudication');

export const RATERS = Object.freeze(['A', 'B']);
export const ANSWERS = Object.freeze(['passed', 'failed', 'cantTell', 'inapplicable']);

/** Answers whose reasoning a resolver will need, so a note is required with them. */
const NOTE_REQUIRED = new Set(['failed', 'cantTell']);

/** A worksheet larger than this is not a worksheet a person could finish. */
const MAX_CELLS = 5_000;

const any = (...patterns) => patterns;

/**
 * The mechanical pre-screen, written out per rule so a reader can check every entry.
 *
 * A cell may be pre-filled `inapplicable` only when none of the listed patterns occurs
 * anywhere in the page source, with comments and `<style>` blocks removed first. That is
 * element absence and nothing else: a pattern that matches more than it should only means
 * a person rates a cell the pre-screen could have skipped, which is safe, and the
 * patterns are written to err that way. `null` means the rule applies to every HTML page,
 * or its applicability needs judgment, so it is never pre-screened.
 *
 * A pre-filled cell is a suggestion, not a verdict. A rater who disagrees changes the
 * answer, and the cell then counts as human-judged like any other.
 */
export const PRESCREEN = Object.freeze({
  '047fe0': null,
  '09o5cg': null,
  '23a2a8': any(/<img\b/i, /\srole\s*=\s*["']?[^"'>]*\bimg\b/i),
  '24afc2': any(/\sstyle\s*=\s*(?:"[^"]*letter-spacing|'[^']*letter-spacing)/i),
  '2779a5': null,
  '2ee8b8': null,
  '36b590': any(
    /<(?:input|select|textarea)\b/i,
    /\srole\s*=\s*["']?[^"'>]*\b(?:textbox|combobox|listbox|searchbox|spinbutton|checkbox|radio|slider|switch)\b/i,
  ),
  '3ea0c8': any(/\sid\s*=/i),
  '46ca7f': any(/\srole\s*=\s*["']?[^"'>]*\b(?:none|presentation)\b/i),
  '4e8ab6': any(/\srole\s*=/i),
  '59796f': any(/<input\b[^>]*\stype\s*=\s*["']?image\b/i),
  '5b7ae0': any(/\sxml:lang\s*=/i),
  '5c01ea': any(/\saria-[a-z]+\s*=/i),
  '5f99a7': any(/\saria-[a-z]+\s*=/i),
  '674b10': any(/\srole\s*=/i),
  '6a7281': any(/\saria-[a-z]+\s*=/i),
  '6cfa84': any(/\saria-hidden\s*=/i),
  '78fd32': any(/\sstyle\s*=\s*(?:"[^"]*line-height|'[^']*line-height)/i),
  '7d6734': any(/<svg\b/i),
  '8fc3b6': any(/<object\b/i),
  '97a4e1': any(
    /<button\b/i,
    /<input\b[^>]*\stype\s*=\s*["']?(?:button|submit|reset)\b/i,
    /\srole\s*=\s*["']?[^"'>]*\bbutton\b/i,
  ),
  '9e45ec': any(/\sstyle\s*=\s*(?:"[^"]*word-spacing|'[^']*word-spacing)/i),
  '9eb3f6': any(/<img\b/i, /<input\b[^>]*\stype\s*=\s*["']?image\b/i),
  afw4f7: null,
  b40fd1: null,
  b4f0c3: any(/<meta\b[^>]*\sname\s*=\s*["']?viewport\b/i),
  b5c3f8: null,
  bc4a75: any(/\srole\s*=/i),
  bc659a: any(/<meta\b[^>]*\shttp-equiv\s*=\s*["']?refresh\b/i),
  bf051a: any(/<html\b[^>]*\slang\s*=/i),
  bisz58: any(/<meta\b[^>]*\shttp-equiv\s*=\s*["']?refresh\b/i),
  c487ae: any(/<a\b/i, /<area\b/i, /\srole\s*=\s*["']?[^"'>]*\blink\b/i),
  cae760: any(/<iframe\b/i),
  cf77f2: null,
  de46e4: any(/\slang\s*=/i),
  e086e5: any(
    /<(?:input|select|textarea)\b/i,
    /\srole\s*=\s*["']?[^"'>]*\b(?:textbox|combobox|listbox|searchbox|spinbutton|checkbox|radio|slider|switch|menuitemcheckbox|menuitemradio|option)\b/i,
  ),
  e6952f: null,
  e88epe: any(/<img\b/i, /<svg\b/i, /<canvas\b/i),
  ff89c9: any(/\srole\s*=/i),
  ffd0e9: any(/<h[1-6]\b/i, /\srole\s*=\s*["']?[^"'>]*\bheading\b/i),
  ye5d6e: null,
});

/** The page source with comments and style blocks removed, for the pre-screen only. */
export function prescreenSource(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
}

/**
 * True when the pre-screen may pre-fill this cell as inapplicable. Throws for a rule the
 * table does not list, so a rule added to Marlo cannot be silently skipped.
 */
export function prescreened(rule, source) {
  if (!Object.hasOwn(PRESCREEN, rule)) {
    throw new Error(`PRESCREEN in scripts/adjudicate.mjs has no entry for ${rule}. Add one.`);
  }
  const patterns = PRESCREEN[rule];
  if (patterns === null) return false;
  return !patterns.some((pattern) => pattern.test(source));
}

/** FNV-1a over the seed string, then mulberry32. Small, deterministic and dependency-free. */
export function seededRandom(seed) {
  let hash = 0x811c9dc5;
  for (const char of String(seed)) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let state = hash;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Fisher-Yates with a seeded generator. Same seed, same order, on every machine. */
export function seededShuffle(items, seed) {
  const out = [...items];
  const random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const cellKey = (page, rule) => `${page}/${rule}`;

/**
 * Builds one rater's worksheet. The order is shuffled with the rater id as the seed, so
 * the two raters meet the cells in different orders and neither order follows a page or a
 * rule, which would let fatigue land on the same cells for both.
 *
 * @param {string} rater
 * @param {{id: string, category: string, path: string}[]} pages
 * @param {{id: string, name: string}[]} rules
 * @param {(page: {path: string}) => string} readPage
 */
export function buildSheet(rater, pages, rules, readPage) {
  if (!RATERS.includes(rater)) throw new Error(`rater must be one of ${RATERS.join(', ')}`);
  if (pages.length * rules.length > MAX_CELLS) {
    throw new Error(
      `${String(pages.length * rules.length)} cells is over the ${String(MAX_CELLS)} cap`,
    );
  }
  const cells = [];
  for (const page of pages) {
    const source = prescreenSource(readPage(page));
    for (const rule of rules) {
      const screened = prescreened(rule.id, source);
      cells.push({
        page: page.id,
        category: page.category,
        file: page.path,
        rule: rule.id,
        ruleName: rule.name,
        ruleUrl: `https://act-rules.github.io/rules/${rule.id}`,
        answer: screened ? 'inapplicable' : null,
        prescreened: screened,
        note: '',
      });
    }
  }
  return {
    rater,
    protocol: 'PROTOCOL.md',
    instructions:
      'Answer every cell with passed, failed, cantTell or inapplicable, judged from the page ' +
      'file alone. A note is required with failed and cantTell. Pre-screened cells are ' +
      'pre-filled inapplicable because no element the rule applies to occurs in the source; ' +
      "change the answer if that is wrong. Do not open the other rater's sheet.",
    cells: seededShuffle(cells, rater),
  };
}

/** A pre-screened cell left alone is a mechanical answer, not a human judgment. */
const untouchedPrescreen = (cell) => cell.prescreened === true && cell.answer === 'inapplicable';

/**
 * Checks a worksheet against the cells the corpus has. Returns problems, never throws.
 *
 * @param {unknown} sheet
 * @param {Set<string>} expected the `page/rule` keys a complete sheet must cover
 */
export function validateSheet(sheet, expected) {
  const problems = [];
  if (typeof sheet !== 'object' || sheet === null || !Array.isArray(sheet.cells)) {
    return ['not a worksheet: no cells array'];
  }
  if (!RATERS.includes(sheet.rater)) problems.push(`rater "${String(sheet.rater)}" is not A or B`);
  const seen = new Set();
  for (const cell of sheet.cells) {
    const key = cellKey(cell.page, cell.rule);
    if (seen.has(key)) problems.push(`${key}: appears twice`);
    seen.add(key);
    if (!expected.has(key)) problems.push(`${key}: not a cell of this corpus`);
    if (cell.answer !== null && !ANSWERS.includes(cell.answer)) {
      problems.push(`${key}: answer "${String(cell.answer)}" is not one of ${ANSWERS.join(', ')}`);
    }
    if (typeof cell.prescreened !== 'boolean')
      problems.push(`${key}: prescreened is not a boolean`);
    if (typeof cell.note !== 'string') problems.push(`${key}: note is not a string`);
    else if (NOTE_REQUIRED.has(cell.answer) && cell.note.trim() === '') {
      problems.push(`${key}: ${String(cell.answer)} needs a note saying why`);
    }
  }
  for (const key of expected) if (!seen.has(key)) problems.push(`${key}: missing`);
  return problems;
}

/**
 * Cohen's kappa and observed agreement over pairs of answers. The same definition as
 * `cohensKappa` in packages/calibrate/src/real-harness.ts, and both are tested against
 * the same hand-computed example.
 *
 * @param {[string, string][]} pairs
 */
export function cohensKappa(pairs) {
  const n = pairs.length;
  if (n === 0) return { percentAgreement: null, kappa: null };
  const left = new Map();
  const right = new Map();
  let agree = 0;
  for (const [a, b] of pairs) {
    if (a === b) agree += 1;
    left.set(a, (left.get(a) ?? 0) + 1);
    right.set(b, (right.get(b) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [category, count] of left) pe += (count / n) * ((right.get(category) ?? 0) / n);
  if (Math.abs(1 - pe) < 1e-12) return { percentAgreement: po, kappa: null };
  return { percentAgreement: po, kappa: (po - pe) / (1 - pe) };
}

/**
 * Pairs the two sheets cell by cell and sorts every cell into one bucket.
 *
 *   human        both answered, and not both an untouched pre-screen. Kappa runs on these.
 *   prescreen    both left the pre-screen as it was.
 *   pending      at least one rater has not answered.
 *
 * `disagreements` is the human cells whose answers differ.
 */
export function pairSheets(a, b) {
  const right = new Map(b.cells.map((c) => [cellKey(c.page, c.rule), c]));
  const human = [];
  const prescreen = [];
  const pending = [];
  for (const left of a.cells) {
    const key = cellKey(left.page, left.rule);
    const other = right.get(key);
    if (other === undefined || left.answer === null || other.answer === null) {
      pending.push(key);
    } else if (untouchedPrescreen(left) && untouchedPrescreen(other)) {
      prescreen.push({ key, a: left, b: other });
    } else {
      human.push({ key, a: left, b: other });
    }
  }
  const disagreements = human.filter((cell) => cell.a.answer !== cell.b.answer);
  return { human, prescreen, pending, disagreements };
}

/** Validates resolutions.json entries. Returns problems. */
export function validateResolutions(resolutions, disagreementKeys) {
  const problems = [];
  const seen = new Set();
  for (const entry of resolutions) {
    const key = cellKey(entry.page, entry.rule);
    if (seen.has(key)) problems.push(`resolution ${key}: appears twice`);
    seen.add(key);
    if (!ANSWERS.includes(entry.answer))
      problems.push(`resolution ${key}: answer is not an outcome`);
    if (typeof entry.resolver !== 'string' || entry.resolver.trim() === '') {
      problems.push(`resolution ${key}: names no resolver`);
    }
    if (typeof entry.reasoning !== 'string' || entry.reasoning.trim() === '') {
      problems.push(`resolution ${key}: gives no reasoning`);
    }
    if (!disagreementKeys.has(key)) {
      problems.push(
        `resolution ${key}: the raters did not disagree here, so there is nothing to resolve. ` +
          'A resolution may not overrule two raters who agreed.',
      );
    }
  }
  return problems;
}

/**
 * Merges agreements and resolutions into ground truth.
 *
 * A cell both raters answered the same way is resolved by agreement. A disagreement is
 * resolved only by an entry in resolutions.json naming its resolver and reasoning, and a
 * disagreement without one is refused, so resolved.json never contains a cell somebody
 * picked a side on silently. A pre-screened cell both raters left alone is resolved
 * `inapplicable`, but only on a page both raters have finished, because leaving a
 * pre-fill alone counts as confirming it only once the rest of the page has been read.
 * Cells still pending are left out and counted as unresolved by the harness.
 */
export function resolveCells(a, b, resolutions) {
  const paired = pairSheets(a, b);
  const disagreementKeys = new Set(paired.disagreements.map((d) => d.key));
  const problems = validateResolutions(resolutions, disagreementKeys);
  const byKey = new Map(resolutions.map((r) => [cellKey(r.page, r.rule), r]));

  const unfinished = new Set();
  for (const sheet of [a, b]) {
    for (const cell of sheet.cells) {
      if (cell.answer === null) unfinished.add(cell.page);
    }
  }

  const cells = [];
  for (const cell of paired.human) {
    if (cell.a.answer === cell.b.answer) {
      cells.push({
        page: cell.a.page,
        rule: cell.a.rule,
        answer: cell.a.answer,
        source: 'agreement',
      });
      continue;
    }
    const resolution = byKey.get(cell.key);
    if (resolution === undefined) {
      problems.push(
        `${cell.key}: A said ${String(cell.a.answer)}, B said ${String(cell.b.answer)}, and ` +
          'resolutions.json has no entry for it',
      );
      continue;
    }
    cells.push({
      page: cell.a.page,
      rule: cell.a.rule,
      answer: resolution.answer,
      source: 'resolution',
      resolver: resolution.resolver,
      reasoning: resolution.reasoning,
    });
  }
  for (const cell of paired.prescreen) {
    if (unfinished.has(cell.a.page)) continue;
    cells.push({
      page: cell.a.page,
      rule: cell.a.rule,
      answer: 'inapplicable',
      source: 'prescreen',
    });
  }
  cells.sort((x, y) => x.page.localeCompare(y.page) || x.rule.localeCompare(y.rule));
  return { cells, problems, pending: paired.pending.length };
}

/** DISAGREEMENTS.md: every cell the raters differed on, what each said, and the outcome. */
export function renderDisagreements(paired, resolutions, labels) {
  const byKey = new Map(resolutions.map((r) => [cellKey(r.page, r.rule), r]));
  const { percentAgreement, kappa } = cohensKappa(
    paired.human.map((c) => [c.a.answer, c.b.answer]),
  );
  const fmt = (value) => (value === null ? 'not defined' : value.toFixed(4));
  const lines = [
    '# Disagreements',
    '',
    'Generated by `node scripts/adjudicate.mjs agreement`. Do not edit: record a resolution in',
    '`resolutions.json` and regenerate.',
    '',
    `Human-judged cells: ${String(paired.human.length)}. Pre-screened cells both raters left alone: ` +
      `${String(paired.prescreen.length)}. Cells not yet answered by both: ${String(paired.pending.length)}.`,
    '',
    `Percent agreement: ${fmt(percentAgreement)}. Cohen's kappa: ${fmt(kappa)}.`,
    '',
  ];
  if (paired.disagreements.length === 0) {
    lines.push('No disagreements yet.', '');
    return `${lines.join('\n')}\n`;
  }
  lines.push(`${String(paired.disagreements.length)} disagreement(s).`, '');
  for (const cell of [...paired.disagreements].sort((x, y) => x.key.localeCompare(y.key))) {
    const resolution = byKey.get(cell.key);
    lines.push(`## ${labels.get(cell.a.page) ?? cell.a.page}, rule ${cell.a.rule}`);
    lines.push('');
    lines.push(`Page \`${cell.a.page}\`. ${String(cell.a.ruleName ?? '')}`);
    lines.push('');
    lines.push(`- Rater A: **${String(cell.a.answer)}**. ${cell.a.note.trim() || '(no note)'}`);
    lines.push(`- Rater B: **${String(cell.b.answer)}**. ${cell.b.note.trim() || '(no note)'}`);
    lines.push(
      resolution === undefined
        ? '- Resolution: **unresolved**.'
        : `- Resolution: **${resolution.answer}**, by ${resolution.resolver}. ${resolution.reasoning}`,
    );
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

// Everything below is the command line. The functions above are what the tests exercise.

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * The pages, the implemented rules and the cell keys a complete worksheet covers. Exported
 * so scripts/rate.mjs validates against exactly the cell set `validate` uses.
 */
export async function corpusContext() {
  const manifest = readJson(join(REAL, 'MANIFEST.json'));
  let rules;
  try {
    const [{ IMPLEMENTED_RULES }, { findRule }] = await Promise.all([
      import('@marlo/rules'),
      import('@marlo/act'),
    ]);
    rules = IMPLEMENTED_RULES.map((id) => ({ id, name: findRule(id)?.name ?? id }));
  } catch (error) {
    throw new Error(
      `cannot load the implemented rule list (${error instanceof Error ? error.message : String(error)}). ` +
        'Run `pnpm build` first.',
    );
  }
  const pages = manifest.pages.map((p) => ({
    id: p.id,
    category: p.category,
    path: p.path,
    sha256: p.sha256,
  }));
  const expected = new Set(pages.flatMap((p) => rules.map((r) => cellKey(p.id, r.id))));
  const labels = new Map(pages.map((p) => [p.id, `${p.category} (${p.sha256.slice(0, 12)})`]));
  return { pages, rules, expected, labels };
}

const sheetPath = (rater) => join(ADJUDICATION, `sheet-${rater}.json`);
const RESOLUTIONS = join(ADJUDICATION, 'resolutions.json');

function readResolutions() {
  if (!existsSync(RESOLUTIONS)) return [];
  const parsed = readJson(RESOLUTIONS);
  return Array.isArray(parsed.resolutions) ? parsed.resolutions : [];
}

function readBoth(expected) {
  const sheets = {};
  const problems = [];
  for (const rater of RATERS) {
    if (!existsSync(sheetPath(rater))) {
      problems.push(`sheet-${rater}.json does not exist. Run \`sheet --rater ${rater}\`.`);
      continue;
    }
    sheets[rater] = readJson(sheetPath(rater));
    for (const p of validateSheet(sheets[rater], expected)) problems.push(`sheet-${rater}: ${p}`);
  }
  return { a: sheets.A, b: sheets.B, problems };
}

function report(problems, what) {
  console.error(`\n${what}: ${String(problems.length)} problem(s)\n`);
  for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
  if (problems.length > 40) console.error(`  ...and ${String(problems.length - 40)} more.`);
  process.exitCode = 1;
}

async function main(argv) {
  const command = argv[0];
  const context = await corpusContext();

  if (command === 'sheet') {
    const rater = argv[argv.indexOf('--rater') + 1];
    if (!argv.includes('--rater') || !RATERS.includes(rater)) {
      console.error('usage: node scripts/adjudicate.mjs sheet --rater A|B');
      process.exitCode = 2;
      return;
    }
    const file = sheetPath(rater);
    if (existsSync(file)) {
      const existing = readJson(file);
      const started = (existing.cells ?? []).some(
        (c) =>
          (c.answer !== null && !untouchedPrescreen(c)) ||
          (typeof c.note === 'string' && c.note !== ''),
      );
      if (started) {
        console.error(
          `sheet-${rater}.json already has answers in it. Refusing to overwrite a rater's work.`,
        );
        process.exitCode = 1;
        return;
      }
    }
    const sheet = buildSheet(rater, context.pages, context.rules, (p) =>
      readFileSync(join(REAL, p.path), 'utf8'),
    );
    writeFileSync(file, `${JSON.stringify(sheet, null, 2)}\n`, 'utf8');
    const screened = sheet.cells.filter((c) => c.prescreened).length;
    console.log(
      `Wrote sheet-${rater}.json: ${String(sheet.cells.length)} cells, ${String(screened)} pre-screened ` +
        `inapplicable, ${String(sheet.cells.length - screened)} for a person to judge.`,
    );
    return;
  }

  if (command === 'validate') {
    const { a, b, problems } = readBoth(context.expected);
    if (a !== undefined && b !== undefined) {
      const paired = pairSheets(a, b);
      problems.push(
        ...validateResolutions(readResolutions(), new Set(paired.disagreements.map((d) => d.key))),
      );
    }
    if (problems.length > 0) report(problems, 'validate');
    else console.log(`validate: both worksheets cover all ${String(context.expected.size)} cells.`);
    return;
  }

  if (command === 'agreement' || command === 'resolve') {
    const { a, b, problems } = readBoth(context.expected);
    if (problems.length > 0) {
      report(problems, command);
      return;
    }
    const resolutions = readResolutions();
    if (command === 'agreement') {
      const paired = pairSheets(a, b);
      writeFileSync(
        join(ADJUDICATION, 'DISAGREEMENTS.md'),
        renderDisagreements(paired, resolutions, context.labels),
        'utf8',
      );
      const { percentAgreement, kappa } = cohensKappa(
        paired.human.map((c) => [c.a.answer, c.b.answer]),
      );
      console.log(
        `agreement: ${String(paired.human.length)} human-judged cells, ` +
          `percent agreement ${percentAgreement === null ? 'not defined' : percentAgreement.toFixed(4)}, ` +
          `kappa ${kappa === null ? 'not defined' : kappa.toFixed(4)}, ` +
          `${String(paired.disagreements.length)} disagreement(s). Wrote DISAGREEMENTS.md.`,
      );
      return;
    }
    const resolved = resolveCells(a, b, resolutions);
    if (resolved.problems.length > 0) {
      report(resolved.problems, 'resolve refused, nothing written');
      return;
    }
    writeFileSync(
      join(ADJUDICATION, 'resolved.json'),
      `${JSON.stringify({ protocol: 'PROTOCOL.md', cells: resolved.cells }, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `resolve: ${String(resolved.cells.length)} of ${String(context.expected.size)} cells resolved, ` +
        `${String(resolved.pending)} pending. Wrote resolved.json.`,
    );
    return;
  }

  console.error(
    'usage: node scripts/adjudicate.mjs sheet --rater A|B | validate | agreement | resolve',
  );
  process.exitCode = 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
