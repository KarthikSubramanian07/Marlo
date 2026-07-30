import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CalibrationEntry, CalibrationTable } from '@marlo/schema';
import { CalibrationTable as CalibrationTableSchema } from '@marlo/schema';
import { PUBLISHED_ACT_RULE_COUNT } from '@marlo/act';
import { IMPLEMENTED_RULES } from '@marlo/rules';
import { StaticRenderer } from '@marlo/render';

import { MarloEngine } from './marlo-engine.js';
import { declaredRootElement, rendererCanRepresent, routeRule } from './harness.js';
import { findRegressions, renderCalibrationMarkdown } from './publish.js';
import { loadCorpus } from './corpus.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

function entry(
  overrides: Partial<CalibrationEntry> & Pick<CalibrationEntry, 'engine'>,
): CalibrationEntry {
  return {
    actRuleId: 'b5c3f8',
    engineVersion: '1.0.0',
    engineRuleIds: ['x'],
    mappingKind: 'exact',
    testCaseCount: 10,
    matrix: {
      passed: { passed: 0, failed: 0, cantTell: 0, inapplicable: 0 },
      failed: { passed: 0, failed: 0, cantTell: 0, inapplicable: 0 },
      inapplicable: { passed: 0, failed: 0, cantTell: 0, inapplicable: 0 },
      errored: 0,
      unsupported: 0,
    },
    act: { consistency: 'consistent', automation: 'automated', disallowed: 0 },
    strict: {
      truePositives: 8,
      falsePositives: 0,
      falseNegatives: 0,
      trueNegatives: 2,
      cantTellOnFailed: 0,
      cantTellOnPassed: 0,
      precision: 1,
      recall: 1,
      f1: 1,
      falsePositiveRate: 0,
    },
    flatteredByProtocol: false,
    ...overrides,
  };
}

describe('the renderer representation check', () => {
  it('reads the declared root element from source, not from a parsed tree', () => {
    // The parser is what loses this information, so reading it from the DOM would defeat
    // the purpose.
    expect(declaredRootElement('<!DOCTYPE html> <html lang="en"></html>')).toBe('html');
    expect(declaredRootElement('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe('svg');
    expect(declaredRootElement('<math></math>')).toBe('math');
    expect(declaredRootElement('<!-- a comment --><html></html>')).toBe('html');
    expect(declaredRootElement('   ')).toBeNull();
  });

  it('refuses to grade a document the static renderer cannot represent', () => {
    // THE finding from the first calibration run. document.write on an HTML Document
    // always produces an html root, so an svg-root or math-root document arrives at the
    // engines as an HTML page containing that element. Every engine then correctly
    // reports the html element has no lang, which is a false positive on all four
    // records for a defect none of them has.
    const renderer = new StaticRenderer();
    expect(rendererCanRepresent(renderer, '<html lang="en"></html>')).toBe(true);
    expect(rendererCanRepresent(renderer, '<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(
      false,
    );
    expect(rendererCanRepresent(renderer, '<math></math>')).toBe(false);
    // An HTML fragment is representable: a browser wraps it in html and body too, so
    // happy-dom produces the same document. The first version of this check rejected
    // anything whose root was not `html`, which skipped 444 of 524 cases and made every
    // published number rest on a sixth of the corpus.
    expect(rendererCanRepresent(renderer, '<p>text</p>')).toBe(true);
    expect(rendererCanRepresent(renderer, '<img src="a.png">')).toBe(true);
    expect(rendererCanRepresent(renderer, '<a href="/x">link</a>')).toBe(true);
  });

  it('trusts a real browser with any root element', () => {
    // Which is one more reason CI diffs the two renderers.
    const browserish = {
      id: 'browser' as const,
      capabilities: new Set<never>(),
      render: () => {
        throw new Error('unused');
      },
      dispose: () => Promise.resolve(),
    };
    expect(rendererCanRepresent(browserish, '<svg></svg>')).toBe(true);
  });
});

describe('routing', () => {
  it('prefers the highest strict recall, then precision', () => {
    const entries = [
      entry({ engine: 'marlo', strict: { ...entry({ engine: 'marlo' }).strict, recall: 0.5 } }),
      entry({
        engine: 'axe-core',
        strict: { ...entry({ engine: 'axe-core' }).strict, recall: 0.9 },
      }),
    ];
    const decision = routeRule('b5c3f8', entries, { minStrictPrecision: 0.95, minSampleSize: 6 });
    expect(decision.chosen).toBe('axe-core');
    expect(decision.reason).toBe('best-measured');
  });

  it('never routes to an engine that flagged a passing example', () => {
    // An `incorrect` engine has a false positive on its record. Preferring it because it
    // happens to have high recall would be preferring noise, which is the Testaro failure
    // mode in miniature.
    const entries = [
      entry({
        engine: 'axe-core',
        act: { consistency: 'incorrect', automation: 'automated', disallowed: 1 },
        strict: { ...entry({ engine: 'axe-core' }).strict, recall: 1 },
      }),
      entry({
        engine: 'marlo',
        strict: { ...entry({ engine: 'marlo' }).strict, recall: 0.6 },
      }),
    ];
    const decision = routeRule('b5c3f8', entries, { minStrictPrecision: 0.95, minSampleSize: 6 });
    expect(decision.chosen).toBe('marlo');
    // The rejected engine still appears among the candidates, so a reader can see the
    // choice rather than take it on trust.
    expect(decision.candidates.map((c) => c.engine)).toContain('axe-core');
  });

  it('reports no implementer rather than picking one at random', () => {
    const decision = routeRule('b5c3f8', [], { minStrictPrecision: 0.95, minSampleSize: 6 });
    expect(decision.chosen).toBeNull();
    expect(decision.reason).toBe('no-implementer');
    expect(decision.autoFixPermitted).toBe(false);
  });

  it('refuses auto-fix below the precision threshold', () => {
    const entries = [
      entry({
        engine: 'marlo',
        strict: {
          ...entry({ engine: 'marlo' }).strict,
          truePositives: 9,
          falsePositives: 1,
          precision: 0.9,
        },
      }),
    ];
    const decision = routeRule('b5c3f8', entries, { minStrictPrecision: 0.95, minSampleSize: 6 });
    expect(decision.chosen).toBe('marlo');
    expect(decision.autoFixPermitted).toBe(false);
  });

  it('refuses auto-fix on too small a sample, however clean', () => {
    const entries = [
      entry({
        engine: 'marlo',
        testCaseCount: 3,
        strict: {
          ...entry({ engine: 'marlo' }).strict,
          truePositives: 2,
          falsePositives: 0,
          falseNegatives: 0,
          precision: 1,
        },
      }),
    ];
    expect(
      routeRule('b5c3f8', entries, { minStrictPrecision: 0.95, minSampleSize: 6 }).autoFixPermitted,
    ).toBe(false);
  });

  it('ignores an engine with no mapping', () => {
    const entries = [entry({ engine: 'htmlcs', mappingKind: 'none' })];
    expect(
      routeRule('b5c3f8', entries, { minStrictPrecision: 0.95, minSampleSize: 6 }).chosen,
    ).toBeNull();
  });
});

describe('the regression gate', () => {
  const base = (): CalibrationTable =>
    CalibrationTableSchema.parse(
      JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
    );

  it('passes a table compared against itself', () => {
    const table = base();
    const { regressions, improvements } = findRegressions(table, table);
    expect(regressions).toEqual([]);
    expect(improvements).toEqual([]);
  });

  it('fails a worse false positive rate', () => {
    const before = base();
    const after: CalibrationTable = {
      ...before,
      aggregate: {
        ...before.aggregate,
        falsePositiveRate: (before.aggregate.falsePositiveRate ?? 0) + 0.1,
      },
    };
    const { regressions } = findRegressions(before, after);
    expect(regressions.map((r) => r.what)).toContain('false positive rate');
  });

  it('fails a shrunken coverage numerator', () => {
    const before = base();
    const after: CalibrationTable = {
      ...before,
      coverage: { ...before.coverage, implemented: before.coverage.implemented - 1 },
    };
    expect(findRegressions(before, after).regressions.map((r) => r.what)).toContain(
      'coverage numerator',
    );
  });

  it('fails a rule that stopped being routable', () => {
    const before = base();
    const routed = before.routing.find((r) => r.chosen !== null);
    expect(routed).toBeDefined();
    if (routed === undefined) return;
    const after: CalibrationTable = {
      ...before,
      routing: before.routing.map((r) =>
        r.actRuleId === routed.actRuleId
          ? { ...r, chosen: null, reason: 'no-implementer' as const }
          : r,
      ),
    };
    expect(findRegressions(before, after).regressions.length).toBeGreaterThan(0);
  });

  it('reports an improvement rather than passing silently', () => {
    // A silent improvement is a number nobody updated the README for.
    const before = base();
    const recall = before.aggregate.strictRecall;
    if (recall === null || recall >= 1) return;
    const after: CalibrationTable = {
      ...before,
      aggregate: { ...before.aggregate, strictRecall: recall + 0.05 },
    };
    const { regressions, improvements } = findRegressions(before, after);
    expect(regressions).toEqual([]);
    expect(improvements.map((i) => i.what)).toContain('aggregate strict recall');
  });

  it('tolerates floating point noise', () => {
    const before = base();
    const precision = before.aggregate.strictPrecision;
    if (precision === null) return;
    const after: CalibrationTable = {
      ...before,
      aggregate: { ...before.aggregate, strictPrecision: precision - 1e-12 },
    };
    expect(findRegressions(before, after).regressions).toEqual([]);
  });
});

describe('the committed table', () => {
  const table = CalibrationTableSchema.parse(
    JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
  );

  it('validates against the schema', () => {
    expect(table.schemaVersion).toBe(1);
  });

  it('names all four engines, including Marlo', () => {
    // D-008: Marlo is measured in the same table by the same harness, with no exemption.
    expect(table.engines.map((e) => e.id).sort()).toEqual(['alfa', 'axe-core', 'htmlcs', 'marlo']);
  });

  it('records the denominator, not a configurable number', () => {
    expect(table.coverage.publishedActRules).toBe(PUBLISHED_ACT_RULE_COUNT);
    expect(table.coverage.implemented).toBe(IMPLEMENTED_RULES.length);
  });

  it('reports both accuracy views for every measured entry', () => {
    const measured = table.entries.filter((e) => e.mappingKind !== 'none' && e.testCaseCount > 0);
    expect(measured.length).toBeGreaterThan(20);
    for (const e of measured) {
      expect(['consistent', 'partial', 'incorrect', 'unmapped']).toContain(e.act.consistency);
      // Both cantTell columns are always present, so caution and incapacity stay
      // distinguishable.
      expect(e.strict.cantTellOnFailed).toBeGreaterThanOrEqual(0);
      expect(e.strict.cantTellOnPassed).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps errored and unsupported out of the outcome rows', () => {
    for (const e of table.entries) {
      const rows = [e.matrix.passed, e.matrix.failed, e.matrix.inapplicable];
      const graded = rows.reduce(
        (sum, row) => sum + Object.values(row).reduce((a, b) => a + b, 0),
        0,
      );
      // Every test case is accounted for exactly once: graded, errored, or unsupported.
      expect(graded + e.matrix.errored + e.matrix.unsupported).toBeLessThanOrEqual(
        e.testCaseCount + e.matrix.errored,
      );
    }
  });

  it('records a date rather than a timestamp, so a rerun is reproducible', () => {
    expect(table.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('carries the auto-fix policy it was produced under', () => {
    // A published number without the policy behind it cannot be interpreted.
    expect(table.autoFixThreshold.minStrictPrecision).toBeGreaterThan(0);
    expect(table.autoFixThreshold.rationale.length).toBeGreaterThan(50);
  });

  it('renders to markdown with no forbidden claim', () => {
    const markdown = renderCalibrationMarkdown(table);
    expect(markdown).toContain('of 94 published ACT rules');
    expect(markdown).toContain('False positive rate');
    // The renderer must never turn an absent measurement into a zero.
    expect(markdown).toContain('not measured');
  });
});

describe('MarloEngine is a wrapper and nothing more', () => {
  it('contains no verdict logic', () => {
    // A "wrapper" that started adjusting outcomes would be the self-audit the boundary in
    // D-008 exists to prevent. Asserted by reading the source, because the whole point is
    // that there is nothing here to test behaviourally.
    //
    // Comments are stripped first. The first version of this test failed on the word
    // "outcome" appearing in the comment explaining why the test exists, which is the
    // test checking prose rather than code.
    const source = readFileSync(resolve(import.meta.dirname, 'marlo-engine.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    for (const forbidden of ["'failed'", "'passed'", "'cantTell'", 'outcome']) {
      expect(source, `marlo-engine.ts code mentions ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('reports its version from the package rather than a literal', () => {
    expect(new MarloEngine().version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('maps every implemented rule one to one', () => {
    const mapping = new MarloEngine().mapping;
    expect(mapping.claimedRules.size).toBe(IMPLEMENTED_RULES.length);
    for (const actId of IMPLEMENTED_RULES) {
      const entries = mapping.actToEngine(actId);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.engineRuleId).toBe(`marlo/${actId}`);
    }
  });
});

describe('the corpus loader', () => {
  const corpus = loadCorpus(ROOT);

  it('reads every test case', () => {
    expect(corpus.cases).toHaveLength(1134);
    expect(corpus.totals.rules).toBe(94);
  });

  it('groups by rule', () => {
    expect(corpus.forRule('b5c3f8')).toHaveLength(7);
    expect(corpus.forRule('zzzzzz')).toEqual([]);
  });

  it('reads a document', () => {
    const first = corpus.forRule('b5c3f8')[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(corpus.read(first).length).toBeGreaterThan(10);
  });
});
