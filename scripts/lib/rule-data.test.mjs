import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_CLAIMS,
  NOT_OUR_CLAIMS,
  NOT_OUR_PROSE,
  PROSE_RULES,
  SELF,
} from './rule-data.mjs';
import { ROOT, filesToScan } from './scan.mjs';

/**
 * rule-data.mjs is the one file the two repository scanners skip, because a
 * checker cannot scan the file that defines the phrase it forbids. That skip is
 * a hole, and these tests are what keep it a small one.
 *
 * Note that this test file holds no examples of its own. Every worked example
 * comes from the `example` field on the rule, in the skipped file. Keeping a
 * copy here would mean this file needed skipping too, and then there would be
 * two holes rather than one.
 *
 * The load-bearing test is the last one: it reconstructs rule-data.mjs with the
 * two pattern arrays removed and asserts the remainder is clean, so a claim
 * cannot hide in a comment in the one file nobody scans.
 */

const ALL_RULES = [...FORBIDDEN_CLAIMS, ...PROSE_RULES];

/** Does `text` trip `rule`? Resets lastIndex, which a global regex needs. */
function trips(rule, text) {
  rule.pattern.lastIndex = 0;
  return rule.pattern.test(text);
}

describe('the scanner exclusion', () => {
  it('is exactly one file', () => {
    // If this fails because someone added a second exclusion, the right fix is
    // almost never to update this test. It is to write the prose differently.
    const source = readFileSync(resolve(ROOT, 'scripts/lib/scan.mjs'), 'utf8');
    expect(source.match(/f !== \w+/g) ?? []).toEqual(['f !== SELF']);
    expect(SELF).toBe('scripts/lib/rule-data.mjs');
  });

  it('excludes itself and nothing adjacent', () => {
    // Explicit paths rather than the tracked-file listing. filesToScan reads
    // `git ls-files`, which is the index, so a file that is written but not yet
    // staged is legitimately absent. Asserting against the index would make
    // this test depend on whether the working tree happens to be committed.
    const scanned = filesToScan(
      [SELF, 'scripts/check-claims.mjs', 'scripts/check-prose.mjs', 'scripts/lib/scan.mjs'],
      NOT_OUR_CLAIMS,
    );

    expect(scanned).not.toContain(SELF);
    // The checker logic and its shared helper are scanned normally. If either
    // stopped being scanned, an explanatory comment could carry a claim.
    expect(scanned).toContain('scripts/check-claims.mjs');
    expect(scanned).toContain('scripts/check-prose.mjs');
    expect(scanned).toContain('scripts/lib/scan.mjs');
  });

  it('excludes nothing Marlo wrote', () => {
    // Every exclusion is the vendored corpus, the lockfile, or a boilerplate
    // document adopted verbatim. Nothing Marlo composed qualifies.
    const permitted = ['corpus/', 'pnpm-lock.yaml', 'LICENSE', 'CODE_OF_CONDUCT.md'];
    for (const re of [...NOT_OUR_CLAIMS, ...NOT_OUR_PROSE]) {
      expect(
        permitted.some((p) => re.test(p)),
        `unexpected exclusion: ${String(re)}`,
      ).toBe(true);
    }
  });
});

describe('every pattern matches what it claims to match', () => {
  // A regex with a typo matches nothing and the check then passes on
  // everything, silently. Each rule's own example must trip it.
  for (const rule of ALL_RULES) {
    it(rule.id, () => {
      expect(rule.example, `${rule.id} has no example`).toBeTypeOf('string');
      expect(trips(rule, rule.example)).toBe(true);
    });
  }

  it('gives every rule a unique id', () => {
    const ids = ALL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('explains every rule to whoever tripped it', () => {
    for (const rule of FORBIDDEN_CLAIMS) {
      expect(rule.reason.length, `${rule.id} needs a reason`).toBeGreaterThan(20);
    }
    for (const rule of PROSE_RULES) {
      expect(rule.message.length, `${rule.id} needs a message`).toBeGreaterThan(20);
    }
  });

  it('does not trip on ordinary prose', () => {
    // The sentence Marlo is actually entitled to say. If a pattern were widened
    // carelessly, this is what it would start catching.
    const legitimate =
      'Marlo implements 34 of the 94 published ACT rules, with measured accuracy per rule, ' +
      'and reports a repair as fixed only when re-rendering and re-scanning confirm the ' +
      'criterion closed and no new violation appeared.';
    for (const rule of ALL_RULES) {
      expect(trips(rule, legitimate), `${rule.id} fires on legitimate prose`).toBe(false);
    }
  });
});

describe('the checkers fail on a planted phrase', () => {
  // End to end, because a pattern that matches in a unit test and a script that
  // exits zero anyway is two green checks and no protection.
  function plant(name, body) {
    const file = join(mkdtempSync(join(tmpdir(), 'marlo-scan-')), name);
    writeFileSync(file, `# Notes\n\n${body}\n`, 'utf8');
    return file;
  }

  function run(script, file) {
    try {
      execFileSync('node', [resolve(ROOT, script), file], { cwd: ROOT, encoding: 'utf8' });
      return 0;
    } catch (error) {
      return error.status ?? 1;
    }
  }

  for (const rule of FORBIDDEN_CLAIMS) {
    it(`check-claims rejects ${rule.id}`, () => {
      expect(run('scripts/check-claims.mjs', plant('claim.md', rule.example))).not.toBe(0);
    });
  }

  for (const rule of PROSE_RULES) {
    it(`check-prose rejects ${rule.id}`, () => {
      expect(run('scripts/check-prose.mjs', plant('prose.md', rule.example))).not.toBe(0);
    });
  }

  it('both accept clean text', () => {
    const file = plant('clean.md', 'Coverage is 34 of 94 published ACT rules.');
    expect(run('scripts/check-claims.mjs', file)).toBe(0);
    expect(run('scripts/check-prose.mjs', file)).toBe(0);
  });
});

describe('nothing hides in the unscanned file', () => {
  /** rule-data.mjs with the two pattern arrays cut out. */
  function withoutRuleArrays() {
    const source = readFileSync(resolve(ROOT, SELF), 'utf8');
    return ['FORBIDDEN_CLAIMS', 'PROSE_RULES'].reduce((text, name) => {
      const start = text.indexOf(`export const ${name} = [`);
      expect(start, `${name} not found in ${SELF}`).toBeGreaterThan(-1);
      const end = text.indexOf('\n];', start);
      expect(end, `${name} array not terminated in ${SELF}`).toBeGreaterThan(start);
      return text.slice(0, start) + text.slice(end + 3);
    }, source);
  }

  it('has no forbidden claim outside the pattern arrays', () => {
    const stripped = withoutRuleArrays();
    const hits = FORBIDDEN_CLAIMS.filter((rule) => trips(rule, stripped)).map((r) => r.id);
    expect(
      hits,
      `${SELF} is the one file the claim scanner skips, so a forbidden claim outside its ` +
        'pattern arrays would never be caught anywhere. Rewrite the prose.',
    ).toEqual([]);
  });

  it('has no prose problem outside the pattern arrays', () => {
    const stripped = withoutRuleArrays();
    const hits = PROSE_RULES.filter((rule) => trips(rule, stripped)).map((r) => r.id);
    expect(hits, `${SELF} is skipped by the prose scanner too.`).toEqual([]);
  });

  it('exports only the expected names', () => {
    // A new export is a new place for prose to live in the unscanned file.
    const source = readFileSync(resolve(ROOT, SELF), 'utf8');
    const exported = [...source.matchAll(/^export const (\w+)/gm)].map((m) => m[1]).sort();
    expect(exported).toEqual(
      ['FORBIDDEN_CLAIMS', 'NOT_OUR_CLAIMS', 'NOT_OUR_PROSE', 'PROSE_RULES', 'SELF'].sort(),
    );
  });
});
