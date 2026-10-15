#!/usr/bin/env node
/**
 * Fails the build when a number in README.md disagrees with the calibration table.
 *
 * WHY THIS EXISTS, AND WHAT IT CAUGHT
 *
 * README.md is the front page, and its first line is the product claim: a published
 * false positive rate. That number is written by hand. Nothing checked it.
 *
 * So when four rules improved and both peer mappings were measured, every generated
 * artifact moved and the front page did not. For a while this repository published
 * 12.9 percent on its first line while the harness measured 6.4, and the whole build
 * stayed green, because `calibration/README.md` is generated, the site is generated
 * from the same table, and the one surface a reader meets first was neither.
 *
 * That is this project's own argument used against it: a number nothing measured. It
 * is not enough that the table is right. The claim a reader sees has to be the same
 * number, and something has to fail when it is not.
 *
 * WHAT IT CHECKS
 *
 * Every figure below is recomputed from `calibration/table.json` using the same pooling
 * the harness uses, and compared to what README.md says:
 *
 *   the headline false positive rate, in the first paragraph and in the badge
 *   the coverage fraction, in the badge
 *   every cell of the per-engine accuracy table
 *   the corpus sample size
 *   the routing counts
 *   the number of rows in the flattered-by-protocol table
 *   Marlo's rank among the four engines, in words
 *   the same table, sample size and rank for the browser measurement, against
 *     calibration/browser.json
 *   the real-page counts against the table's realCorpus block, and that no rated cell
 *     exists while the README says none does
 *   how many codemod rules clear the auto-fix gate
 *   the recorded scan, line by line, against the committed golden terminal output
 *
 * The static and browser tables share a row format, so each claim is looked up only in
 * the README section it belongs to. A pattern searched across the whole file matched
 * both tables and compared one engine's browser figures with its static ones.
 *
 * A PATTERN THAT STOPS MATCHING IS A FAILURE, NOT A PASS
 *
 * The obvious way to write this is to find each claim with a regular expression and
 * compare it. The obvious way is also how the check quietly stops checking: reword the
 * sentence, the pattern misses, nothing compares, the build is green. So every lookup
 * here is required to match, and an unmatched pattern is reported as loudly as a wrong
 * number. If you reword one of these sentences, this script has to be updated in the
 * same commit, on purpose.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
const table = JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8'));
const browser = JSON.parse(readFileSync(resolve(ROOT, 'calibration/browser.json'), 'utf8'));
const analysis = JSON.parse(readFileSync(resolve(ROOT, 'calibration/analysis.json'), 'utf8'));
const scanScope = analysis.scopes.find((scope) => scope.id === 'scan');
const scanOutput = scanScope?.strategies.find((strategy) => strategy.id === 'scan-output');
const golden = readFileSync(resolve(ROOT, 'tests/golden/checkout-terminal.txt'), 'utf8');
const codemodSource = readFileSync(resolve(ROOT, 'packages/repair/src/codemod.ts'), 'utf8');

const problems = [];

/**
 * The text between two headings, or the empty string when either is missing, which every
 * claim inside it then reports as no longer present.
 */
function section(from, to) {
  const start = readme.indexOf(from);
  if (start === -1) return '';
  const end = to === null ? -1 : readme.indexOf(to, start + from.length);
  return readme.slice(start, end === -1 ? undefined : end);
}

const STATIC_SECTION = section(
  '## The table nobody else publishes',
  '### The same corpus, inside a real browser',
);
const HELD_OUT_SECTION = section(
  '### What the product reports, and what routing does on cases it has not seen',
  '### The same corpus, inside a real browser',
);
const BROWSER_SECTION = section(
  '### The same corpus, inside a real browser',
  '### A second corpus, from real pages',
);
const REAL_SECTION = section('### A second corpus, from real pages', '\n---');
const SCAN_SECTION = section('## What using it looks like', 'Three things there that');

/** Pools the confusion counts the way `aggregateStrictAccuracy` does. */
function pooled(engineId, source = table) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const entry of source.entries) {
    if (entry.engine !== engineId) continue;
    if (entry.mappingKind === 'none' || entry.testCaseCount === 0) continue;
    tp += entry.strict.truePositives;
    fp += entry.strict.falsePositives;
    fn += entry.strict.falseNegatives;
    tn += entry.strict.trueNegatives;
  }
  const ratio = (a, b) => (b === 0 ? null : a / b);
  return {
    rules: new Set(
      source.entries
        .filter((e) => e.engine === engineId && e.mappingKind !== 'none')
        .map((e) => e.actRuleId),
    ).size,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn),
  };
}

/** The README's own vocabulary for a rate, so the comparison is textual rather than fuzzy. */
const rate = (value) => (value === null ? 'not measured' : value.toFixed(3));
const percent = (value) => (value === null ? 'not measured' : `${(value * 100).toFixed(1)}%`);

/**
 * Finds exactly one match, or records a problem. Zero matches means the claim was
 * reworded and this check went blind, which is reported rather than ignored.
 */
function claim(what, pattern, text = readme) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) {
    problems.push(`${what}: no longer present in README.md. Reword the check, not just the prose.`);
    return null;
  }
  return matches;
}

let compared = 0;

function expect(what, actual, wanted) {
  // Null or undefined means `claim` already recorded that the pattern went blind. It is
  // a failure, and it has been reported, so there is nothing left to compare.
  if (actual === null || actual === undefined) return;
  for (const found of actual) {
    compared += 1;
    if (found !== wanted) problems.push(`${what}: README says ${found}, the table says ${wanted}`);
  }
}

const NUMBER_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
];

const marlo = pooled('marlo');

// The first line of the repository, and the badge that repeats it. They state what
// marlo scan reports, measured as a whole in calibration/analysis.json, not the rate of
// Marlo's own rule engine, which is one component of it. HONESTY.md entry 17.
const headline = scanOutput?.falsePositiveRate?.value ?? null;
expect(
  'headline false positive rate',
  claim('headline false positive rate', /Our false positive rate is ([\d.]+%)\./g)?.map(
    (m) => m[1],
  ),
  percent(headline),
);
expect(
  'false positive badge',
  claim('false positive badge', /false_positives-([\d.]+)%25-/g)?.map((m) => `${m[1]}%`),
  percent(headline),
);
expect(
  'headline scope',
  claim('headline scope', /measured as a whole over the (\d+) rules it evaluates/g)?.map(
    (m) => m[1],
  ),
  String(scanScope?.rules ?? 'missing'),
);
expect(
  'engine rate beside the headline',
  claim('engine rate beside the headline', /which is the rate of Marlo's own rule engine/g)?.map(
    () => percent(marlo.falsePositiveRate),
  ),
  percent(marlo.falsePositiveRate),
);
{
  const said = claim('previous headline', /Until recently this line printed ([\d.]+%)/g);
  if (said !== null) {
    expect(
      'previous headline',
      said.map((m) => m[1]),
      percent(marlo.falsePositiveRate),
    );
  }
}

expect(
  'coverage badge',
  claim('coverage badge', /ACT_rules-(\d+)_of_(\d+)-/g)?.map((m) => `${m[1]} of ${m[2]}`),
  `${String(table.coverage.implemented)} of ${String(table.coverage.publishedActRules)}`,
);
expect(
  'corpus sample size',
  claim('corpus sample size', /Four engines, ([\d,]+) official test case outcomes/g)?.map(
    (m) => m[1],
  ),
  String(table.aggregate.sampleSize),
);

// The per-engine tables. Every cell, not only Marlo's row, each against its own table.
const LABELS = {
  Alfa: 'alfa',
  'axe-core': 'axe-core',
  Marlo: 'marlo',
  'HTML CodeSniffer': 'htmlcs',
};
const ORDINALS = ['first', 'second', 'third', 'fourth'];

function checkEngineTable(name, text, source, labelSuffix) {
  for (const [label, id] of Object.entries(LABELS)) {
    const cell = `${label}${labelSuffix}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const row = claim(
      `${name}: ${label} row`,
      new RegExp(
        `\\|\\s*\\*{0,2}${cell}\\*{0,2}\\s*\\|` +
          `\\s*\\*{0,2}(\\d+)\\*{0,2}\\s*\\|\\s*\\*{0,2}([\\d.]+|not measured)\\*{0,2}\\s*\\|` +
          `\\s*\\*{0,2}([\\d.]+|not measured)\\*{0,2}\\s*\\|\\s*\\*{0,2}([\\d.]+%|not measured)\\*{0,2}\\s*\\|`,
        'g',
      ),
      text,
    );
    if (row === null) continue;
    const want = pooled(id, source);
    expect(
      `${name}: ${label} rules`,
      row.map((m) => m[1]),
      String(want.rules),
    );
    expect(
      `${name}: ${label} precision`,
      row.map((m) => m[2]),
      rate(want.precision),
    );
    expect(
      `${name}: ${label} recall`,
      row.map((m) => m[3]),
      rate(want.recall),
    );
    expect(
      `${name}: ${label} false positives`,
      row.map((m) => m[4]),
      percent(want.falsePositiveRate),
    );
  }
  // The rank, by false positive rate, which is the published claim.
  const order = Object.values(LABELS)
    .map((id) => ({ id, fpr: pooled(id, source).falsePositiveRate ?? Infinity }))
    .sort((a, b) => a.fpr - b.fpr)
    .map((e) => e.id);
  expect(
    `${name}: Marlo's rank`,
    claim(`${name}: Marlo's rank`, /(first|second|third|fourth) of four/g, text)?.map((m) => m[1]),
    ORDINALS[order.indexOf('marlo')],
  );
}

// The held-out table, every cell against calibration/analysis.json.
{
  const interval = (p, asPercent) =>
    p === null || p === undefined
      ? 'not measured'
      : asPercent
        ? `${(p.value * 100).toFixed(1)}% (${(p.low * 100).toFixed(1)} to ${(p.high * 100).toFixed(1)})`
        : `${p.value.toFixed(3)} (${p.low.toFixed(3)} to ${p.high.toFixed(3)})`;
  const ROWS = {
    'What marlo scan reports': 'scan-output',
    'Routed engine, leave one out': 'routed-held-out',
    'Routed engine, in sample': 'routed-in-sample',
    'Majority of engines': 'majority',
    'Alfa alone': 'single-alfa',
    'axe-core alone': 'single-axe-core',
    'Marlo alone': 'single-marlo',
  };
  const cell = '([\\d.]+%? \\([\\d.]+ to [\\d.]+\\)|not measured)';
  for (const [label, id] of Object.entries(ROWS)) {
    const row = claim(
      `held-out table: ${label}`,
      new RegExp(
        `\\|\\s*${label}\\s*\\|\\s*${cell}\\s*\\|\\s*${cell}\\s*\\|\\s*${cell}\\s*\\|`,
        'g',
      ),
      HELD_OUT_SECTION,
    );
    const strategy = scanScope?.strategies.find((x) => x.id === id);
    if (row === null) continue;
    if (strategy === undefined) {
      problems.push(`held-out table: ${label} has no strategy ${id} in calibration/analysis.json`);
      continue;
    }
    expect(
      `held-out ${label} precision`,
      row.map((m) => m[1]),
      interval(strategy.precision, false),
    );
    expect(
      `held-out ${label} recall`,
      row.map((m) => m[2]),
      interval(strategy.recall, false),
    );
    expect(
      `held-out ${label} false positives`,
      row.map((m) => m[3]),
      interval(strategy.falsePositiveRate, true),
    );
  }
  expect(
    'held-out scope',
    claim(
      'held-out scope',
      /over the (\d+) rules `marlo scan` evaluates and (\d+) official cases/g,
      HELD_OUT_SECTION,
    )?.map((m) => `${m[1]}/${m[2]}`),
    `${String(scanScope?.rules)}/${String(scanScope?.cases)}`,
  );
  expect(
    'routing stability',
    claim(
      'routing stability',
      /changes the router's choice on (\d+) of (\d+) cases/g,
      HELD_OUT_SECTION,
    )?.map((m) => `${m[1]}/${m[2]}`),
    `${String(analysis.routingStability.casesWhereChoiceChanges)}/${String(analysis.routingStability.cases)}`,
  );
  const alfa = scanScope?.strategies.find((x) => x.id === 'single-alfa');
  const heldOut = scanScope?.strategies.find((x) => x.id === 'routed-held-out');
  if (
    claim(
      'routing against Alfa',
      /scores below running Alfa everywhere on both precision and recall, though the intervals overlap/g,
      HELD_OUT_SECTION,
    ) !== null &&
    alfa !== undefined &&
    heldOut !== undefined
  ) {
    compared += 1;
    const below =
      heldOut.precision.value < alfa.precision.value && heldOut.recall.value < alfa.recall.value;
    const overlap =
      heldOut.precision.high >= alfa.precision.low && heldOut.recall.high >= alfa.recall.low;
    if (!below || !overlap) {
      problems.push(
        'routing against Alfa: the README says held-out routing is below Alfa with overlapping intervals, and the analysis no longer shows that',
      );
    }
  }
  expect(
    'union cost at the top',
    claim(
      'union cost at the top',
      /the measured cost of that is the ([\d.]+%) at the top of this page/g,
    )?.map((m) => m[1]),
    percent(headline),
  );
}

checkEngineTable('static table', STATIC_SECTION, table, '');
checkEngineTable('browser table', BROWSER_SECTION, browser, '');
expect(
  'browser sample size',
  claim(
    'browser sample size',
    /Under Chromium, ([\d,]+) test case outcomes are graded/g,
    BROWSER_SECTION,
  )?.map((m) => m[1]),
  String(browser.aggregate.sampleSize),
);

// The contrast claim under the browser renderer: no passing case flagged, and every
// missed failing case a decline rather than a wrong answer.
{
  const entry = browser.entries.find((e) => e.actRuleId === 'afw4f7' && e.engine === 'marlo');
  const said = claim(
    'contrast claim',
    /Marlo computes the ratio from a paint-order walk and has not flagged a passing case/g,
    BROWSER_SECTION,
  );
  if (said !== null && entry !== undefined) {
    compared += 1;
    if (entry.strict.falsePositives !== 0) {
      problems.push(
        `contrast claim: README says no passing case was flagged, the browser table records ${String(entry.strict.falsePositives)}`,
      );
    }
    if (entry.strict.falseNegatives !== entry.strict.cantTellOnFailed) {
      problems.push(
        'contrast claim: README says every miss is a decline, and the browser table has a failing case answered other than cantTell',
      );
    }
  }
}

// The real-page corpus, against its own block.
{
  const real = table.realCorpus;
  const NUMBER_RE = /vendors (\d+) pages from (\d+) kinds of site/g;
  if (real === undefined) {
    problems.push('real pages: README describes a real-page corpus and the table has none');
  } else {
    expect(
      'real pages and categories',
      claim('real pages and categories', NUMBER_RE, REAL_SECTION)?.map((m) => `${m[1]}/${m[2]}`),
      `${String(real.pages)}/${String(real.categories.length)}`,
    );
    const adj = real.adjudication;
    expect(
      'real adjudication cells',
      claim('real adjudication cells', /Every one of the (\d+) cells/g, REAL_SECTION)?.map(
        (m) => m[1],
      ),
      adj.resolvedCells === adj.totalCells ? String(adj.totalCells) : 'not every cell resolved',
    );
    if (
      !adj.raters.some((r) => r.kind === 'model') !==
      !/model-adjudicated, not human judgment/.test(REAL_SECTION)
    ) {
      problems.push(
        'real adjudication: README and table disagree on whether the raters are models',
      );
    }
    expect(
      'real adjudication agreement',
      claim(
        'real adjudication agreement',
        /settled the (\d+) cells where they disagreed\. They agreed on ([\d.]+%) of the (\d+) cells that needed a judgment \(Cohen's kappa ([\d.]+)\)/g,
        REAL_SECTION,
      )?.map((m) => `${m[1]}/${m[2]}/${m[3]}/${m[4]}`),
      `${String(adj.resolutions.model + adj.resolutions.person)}/${percent(adj.percentAgreement)}/${String(adj.ratedCells)}/${rate(adj.kappa)}`,
    );
    const validity = JSON.parse(
      readFileSync(resolve(ROOT, 'corpus/real/adjudication/rater-validity.json'), 'utf8'),
    );
    expect(
      'rater validity',
      claim(
        'rater validity',
        /rated the (\d+) official test cases of the same rules with their names hidden, and the adjudicated labels match the W3C's human-written answers on ([\d.]+%)/g,
        REAL_SECTION,
      )?.map((m) => `${m[1]}/${m[2]}`),
      `${String(validity.cases)}/${percent(validity.graded.adjudicated.agreement.value)}`,
    );
    const pages = analysis.realPages;
    if (pages === null) {
      problems.push('real pages: README publishes real-page accuracy and the analysis has none');
    } else {
      expect(
        'real resolved cells',
        claim('real resolved cells', /\| Real pages, (\d+) resolved cells/g, REAL_SECTION)?.map(
          (m) => m[1],
        ),
        String(pages.resolvedCells),
      );
      const rows = [
        [
          'scan-output',
          /\| \*\*What `marlo scan` reports\*\* +\| \*\*([\d.]+)\*\* +\| \*\*([\d.]+)\*\* +\| \*\*([\d.]+%)\*\*/g,
        ],
        ['single-alfa', /\| Alfa alone +\| ([\d.]+) +\| ([\d.]+) +\| ([\d.]+%)/g],
        ['single-axe-core', /\| axe-core alone +\| ([\d.]+) +\| ([\d.]+) +\| ([\d.]+%)/g],
        ['routed-in-sample', /\| Routed engine +\| ([\d.]+) +\| ([\d.]+) +\| ([\d.]+%)/g],
        ['single-marlo', /\| Marlo's own engine alone +\| ([\d.]+) +\| ([\d.]+) +\| ([\d.]+%)/g],
      ];
      for (const [id, pattern] of rows) {
        const strategy = pages.strategies.find((x) => x.id === id);
        expect(
          `real pages ${id}`,
          claim(`real pages ${id}`, pattern, REAL_SECTION)?.map((m) => `${m[1]}/${m[2]}/${m[3]}`),
          strategy === undefined
            ? 'absent'
            : `${rate(strategy.precision?.value ?? null)}/${rate(strategy.recall?.value ?? null)}/${percent(strategy.falsePositiveRate?.value ?? null)}`,
        );
      }
    }
    expect(
      'real invariant pages',
      claim(
        'real invariant pages',
        /on (\d+) of the (\d+) pages some engine reports a failure/g,
        REAL_SECTION,
      )?.map((m) => `${m[1]}/${m[2]}`),
      `${String(real.aggregate.invariant.pagesWhereItWouldFire)}/${String(real.aggregate.invariant.pages)}`,
    );
    const means = real.aggregate.findingsPerPage
      .map((f) => f.mean)
      .filter((m) => m !== null && m > 0);
    const words = [
      'zero',
      'one order of magnitude',
      'two orders of magnitude',
      'three orders of magnitude',
    ];
    expect(
      'real findings spread',
      claim('real findings spread', /(\w+ orders? of magnitude) apart/g, REAL_SECTION)?.map(
        (m) => m[1],
      ),
      words[Math.floor(Math.log10(Math.max(...means) / Math.min(...means)))] ?? 'more',
    );
  }
}

// The repair gate, stated in prose.
{
  const block = /export const CODEMODS[^{]*\{([\s\S]*?)\n\}/.exec(codemodSource)?.[1] ?? '';
  const ids = [...new Set([...block.matchAll(/'?([0-9a-z]{6})'?\s*:/g)].map((m) => m[1]))];
  const clearing = ids.filter(
    (id) => table.routing.find((r) => r.actRuleId === id)?.autoFixPermitted === true,
  );
  const said = claim('repair gate', /Repair covers (\w+) rules, and applies (\w+) of them/g)?.map(
    (m) => `${m[1].toLowerCase()}/${m[2].toLowerCase()}`,
  );
  const word = (n) => (NUMBER_WORDS[n] ?? String(n)).toLowerCase();
  expect('repair gate', said, `${word(ids.length)}/${word(clearing.length)}`);
}

// The recorded scan, which must be output the scanner produced rather than prose.
{
  const block = /```\n([\s\S]*?)\n```/.exec(SCAN_SECTION)?.[1];
  if (block === undefined) {
    problems.push('recorded scan: no code block found under "What using it looks like"');
  } else {
    for (const line of block.split('\n')) {
      if (line.trim() === '' || line.startsWith('$ marlo')) continue;
      compared += 1;
      if (!golden.includes(line)) {
        problems.push(`recorded scan: not in tests/golden/checkout-terminal.txt: ${line.trim()}`);
      }
    }
  }
}

// Routing, stated in prose next to the table.
const routed = {};
for (const decision of table.routing) {
  const key = decision.chosen ?? 'nobody';
  routed[key] = (routed[key] ?? 0) + 1;
}
expect(
  'routing counts',
  claim(
    'routing counts',
    /router sends (\d+) rules to axe-core against (\d+) to Marlo's own engine/g,
    STATIC_SECTION,
  )?.map((m) => `${m[1]}/${m[2]}`),
  `${String(routed['axe-core'] ?? 0)}/${String(routed['marlo'] ?? 0)}`,
);

// The flattered-by-protocol table, which is the point of publishing two views.
const flattered = table.entries.filter((e) => e.flatteredByProtocol);

expect(
  'flattered entry count',
  claim('flattered entry count', /(\w+) entries currently grade as officially/g)?.map((m) => m[1]),
  NUMBER_WORDS[flattered.length] ?? String(flattered.length),
);
const listed = [
  ...readme.matchAll(/^\| `([0-9a-z]{6})` +\| \*{0,2}[\w-]+\*{0,2} +\| consistent +\|/gm),
].map((m) => m[1]);
const wanted = [...new Set(flattered.map((e) => e.actRuleId))].sort();
if (listed.length === 0) {
  problems.push('flattered table: no rows found in README.md');
} else if ([...new Set(listed)].sort().join(' ') !== wanted.join(' ')) {
  problems.push(
    `flattered table: README lists ${[...new Set(listed)].sort().join(' ')}, the table says ${wanted.join(' ')}`,
  );
}

if (problems.length > 0) {
  console.error('\nREADME.md disagrees with calibration/table.json:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\nThe table is generated by the harness and the README is written by hand, so the README\n' +
      'is what is wrong. Run `pnpm calibrate`, read the diff, and update the prose to match.\n',
  );
  process.exitCode = 1;
} else {
  console.log(
    `check-published-numbers: README.md agrees with the table on ${String(compared)} figures ` +
      `and on the ${String(flattered.length)} rules the protocol flatters.`,
  );
}
