import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
 * The load-bearing test is the last one: it reconstructs rule-data.mjs with the
 * two pattern arrays removed and asserts the remainder is clean. So a claim
 * cannot hide in a comment in the one file nobody scans.
 */
describe('the scanner exclusion', () => {
  it('is exactly one file', () => {
    // If this fails because someone added a second exclusion, the right fix is
    // almost never to update this number. It is to write the prose differently.
    const source = readFileSync(resolve(ROOT, 'scripts/lib/scan.mjs'), 'utf8');
    const skips = source.match(/f !== \w+/g) ?? [];
    expect(skips).toEqual(['f !== SELF']);
    expect(SELF).toBe('scripts/lib/rule-data.mjs');
  });

  it('actually excludes itself and nothing adjacent', () => {
    // Explicit paths rather than the tracked-file listing. filesToScan reads
    // `git ls-files`, which is the index, so a file that is written but not yet
    // staged is legitimately absent. Asserting against the index would make this
    // test depend on whether the working tree happens to be committed.
    const candidates = [
      SELF,
      'scripts/check-claims.mjs',
      'scripts/check-prose.mjs',
      'scripts/lib/scan.mjs',
    ];
    const scanned = filesToScan(candidates, NOT_OUR_CLAIMS);

    expect(scanned).not.toContain(SELF);
    // The checker logic and its shared helper are scanned normally. If either
    // stopped being scanned, an explanatory comment could carry a claim.
    expect(scanned).toContain('scripts/check-claims.mjs');
    expect(scanned).toContain('scripts/check-prose.mjs');
    expect(scanned).toContain('scripts/lib/scan.mjs');
  });

  it('does not exclude anything Marlo wrote', () => {
    for (const re of [...NOT_OUR_CLAIMS, ...NOT_OUR_PROSE]) {
      // Every exclusion is either the vendored corpus, the lockfile, or a
      // boilerplate document adopted verbatim. Nothing else qualifies.
      expect(
        ['corpus/', 'pnpm-lock.yaml', 'LICENSE', 'CODE_OF_CONDUCT.md'].some((p) => re.test(p)),
      ).toBe(true);
    }
  });
});

describe('every pattern matches what it claims to match', () => {
  // A regex with a typo matches nothing and the check passes on everything,
  // silently. Each pattern gets an example that must trip it.
  const claimExamples = {
    'wcag-certified': 'Marlo is WCAG certified.',
    certified: 'Our output is certified by us.',
    'guaranteed-compliance': 'guaranteed compliance with the standard',
    'fully-accessible': 'your site is fully accessible',
    'perfect-score': 'scored 100% compliant',
    'eliminates-risk': 'eliminates ADA risk',
    'zero-risk': 'zero legal risk',
    'lawsuit-proof': 'lawsuit-proof your product',
    'comprehensive-coverage': 'comprehensive WCAG coverage',
  };

  const proseExamples = {
    'em-dash': 'one thing—another thing',
    'horizontal-bar': 'one thing―another thing',
    'slop-vocabulary': 'we leverage the platform',
    'not-just-x-but-y': 'It is not just a checker, it is a fixer',
    'empty-intensifier': 'truly powerful',
  };

  for (const rule of FORBIDDEN_CLAIMS) {
    it(`claim: ${rule.id}`, () => {
      const example = claimExamples[rule.id];
      expect(example, `no example for ${rule.id}`).toBeDefined();
      rule.pattern.lastIndex = 0;
      expect(rule.pattern.test(example)).toBe(true);
      expect(rule.reason.length).toBeGreaterThan(20);
    });
  }

  for (const rule of PROSE_RULES) {
    it(`prose: ${rule.id}`, () => {
      const example = proseExamples[rule.id];
      expect(example, `no example for ${rule.id}`).toBeDefined();
      rule.pattern.lastIndex = 0;
      expect(rule.pattern.test(example)).toBe(true);
    });
  }

  it('covers every rule with an example', () => {
    expect(Object.keys(claimExamples).sort()).toEqual(FORBIDDEN_CLAIMS.map((r) => r.id).sort());
    expect(Object.keys(proseExamples).sort()).toEqual(PROSE_RULES.map((r) => r.id).sort());
  });
});

describe('the checkers fail on a planted claim', () => {
  // End to end, because a pattern that matches in a unit test and a script that
  // exits zero anyway is two green checks and no protection.
  const plant = (name, content) => {
    const dir = mkdtempSync(join(tmpdir(), 'marlo-claims-'));
    const file = join(dir, name);
    writeFileSync(file, content, 'utf8');
    return file;
  };

  const run = (script, file) => {
    try {
      execFileSync('node', [resolve(ROOT, script), file], { cwd: ROOT, encoding: 'utf8' });
      return 0;
    } catch (error) {
      return error.status ?? 1;
    }
  };

  it('check-claims exits non-zero', () => {
    const file = plant('claim.md', '# Notes\n\nThis output is certified.\n');
    expect(run('scripts/check-claims.mjs', file)).not.toBe(0);
  });

  it('check-prose exits non-zero', () => {
    const file = plant('prose.md', '# Notes\n\nWe leverage the platform.\n');
    expect(run('scripts/check-prose.mjs', file)).not.toBe(0);
  });

  it('both exit zero on clean text', () => {
    const file = plant('clean.md', '# Notes\n\nCoverage is 34 of 94 published ACT rules.\n');
    expect(run('scripts/check-claims.mjs', file)).toBe(0);
    expect(run('scripts/check-prose.mjs', file)).toBe(0);
  });
});

describe('nothing hides in the unscanned file', () => {
  it('has no forbidden claim outside the pattern arrays', () => {
    const source = readFileSync(resolve(ROOT, SELF), 'utf8');

    // Remove the two array literals. What remains is the header comment, the
    // export statements, and any prose someone added, which is the part that
    // would otherwise be unscanned by anything.
    const stripped = ['FORBIDDEN_CLAIMS', 'PROSE_RULES'].reduce((text, name) => {
      const start = text.indexOf(`export const ${name} = [`);
      expect(start, `${name} not found in ${SELF}`).toBeGreaterThan(-1);
      const end = text.indexOf('\n];', start);
      expect(end, `${name} array not terminated in ${SELF}`).toBeGreaterThan(start);
      return text.slice(0, start) + text.slice(end + 3);
    }, source);

    const hits = [];
    for (const rule of FORBIDDEN_CLAIMS) {
      rule.pattern.lastIndex = 0;
      let m;
      while ((m = rule.pattern.exec(stripped)) !== null) {
        hits.push(`${rule.id}: "${m[0]}"`);
        if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex += 1;
      }
    }

    expect(
      hits,
      `${SELF} is the one file the claim scanner skips. A forbidden claim outside its ` +
        'pattern arrays would therefore never be caught. Rewrite the prose.',
    ).toEqual([]);
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
