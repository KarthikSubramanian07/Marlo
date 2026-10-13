import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { EngineId, EngineVerdict, Outcome, RuleResult } from '@marlo/schema';
import { attributeKey, elementKey, uncoveredPeerFailures } from './elements.js';

/**
 * The invariant per element. `decideRule` stops a failed rule being reported clean; these
 * stop a failed element being dropped because the routed engine passed that one element.
 */

function verdict(engine: EngineId, outcome: Outcome, snippet: string): EngineVerdict {
  return {
    engine,
    engineVersion: '1.0.0',
    engineRuleId: `${engine}/rule`,
    actRuleId: 'e086e5',
    outcome,
    target: { selector: 'input', snippet, path: [] },
    message: `${engine} says ${outcome}`,
  };
}

function result(engine: EngineId, verdicts: EngineVerdict[], status: RuleResult['status'] = 'ok') {
  return {
    actRuleId: 'e086e5',
    engine,
    status,
    verdicts: status === 'ok' ? verdicts : [],
    error: status === 'error' ? 'boom' : null,
    missingCapabilities: [],
    durationMs: 0,
  } satisfies RuleResult;
}

const TEL = '<input type="tel" aria-labeledby="phone-hint">';
const CITY = '<input type="text" name="city">';
const EMAIL = '<input type="email" placeholder="Email" name="email">';

describe('elementKey', () => {
  it('ignores attribute order, quoting and case', () => {
    expect(elementKey(`<INPUT name='a' TYPE=text>`)).toBe(
      elementKey('<input type="text" name="a">'),
    );
  });

  it('reads only the opening tag, whatever follows it', () => {
    expect(elementKey('<p class="x">one <b>two</b></p>')).toBe(elementKey('<p class="x">'));
  });

  it('keeps an attribute with no value distinct from an absent one', () => {
    expect(elementKey('<input disabled>')).not.toBe(elementKey('<input>'));
  });

  it('declines evidence that is not an element or whose opening tag was cut off', () => {
    expect(elementKey('')).toBeNull();
    expect(elementKey('text node content')).toBeNull();
    expect(elementKey('<input type="text" name="a very long value that was truncated…')).toBeNull();
  });

  it('bounds the attributes it reads from one tag', () => {
    const many = Array.from({ length: 200 }, (_, i) => `data-a${String(i)}="${String(i)}"`);
    const key = elementKey(`<div ${many.join(' ')}>`);
    expect(key?.split(' ').length).toBe(65);
  });

  it('agrees with itself under any reordering of attributes', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z-]{0,8}$/), { maxLength: 8 }),
        fc.boolean(),
        (names, reverse) => {
          const attrs = names.map((n) => `${n}="v-${n}"`);
          const reordered = reverse ? [...attrs].reverse() : attrs;
          return elementKey(`<a ${attrs.join(' ')}>`) === elementKey(`<a ${reordered.join(' ')}>`);
        },
      ),
    );
  });
});

describe('attributeKey', () => {
  it('reads evidence that is a single attribute in the form elementKey uses', () => {
    expect(attributeKey('ARIA-Checked="true"')).toBe('aria-checked=true');
    expect(attributeKey("aria-required='yes'")).toBe('aria-required=yes');
    expect(elementKey('<a aria-checked="true">')).toContain('aria-checked=true');
  });

  it('declines anything that is not exactly one attribute', () => {
    expect(attributeKey('<a href="x">')).toBeNull();
    expect(attributeKey('a="1" b="2"')).toBeNull();
    expect(attributeKey('plain text')).toBeNull();
  });
});

describe('uncoveredPeerFailures', () => {
  it('reports the element the routed engine passed and a peer failed', () => {
    const results = [
      result('axe-core', [verdict('axe-core', 'failed', CITY), verdict('axe-core', 'passed', TEL)]),
      result('marlo', [verdict('marlo', 'failed', CITY), verdict('marlo', 'failed', TEL)]),
      result('alfa', [verdict('alfa', 'failed', CITY), verdict('alfa', 'failed', TEL)]),
    ];
    const uncovered = uncoveredPeerFailures(results, 'axe-core');
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0]?.verdict.engine).toBe('marlo');
    expect(uncovered[0]?.verdict.target.snippet).toBe(TEL);
    // Attributed once, to the first peer, with the second recorded as agreeing.
    expect(uncovered[0]?.agreedBy).toEqual(['alfa']);
    expect(uncovered[0]?.dissent.map((d) => `${d.engine}:${d.outcome}`)).toEqual([
      'axe-core:passed',
    ]);
  });

  it('reports an element the routed engine said nothing about', () => {
    const results = [
      result('axe-core', [verdict('axe-core', 'failed', CITY)]),
      result('marlo', [verdict('marlo', 'failed', CITY), verdict('marlo', 'failed', EMAIL)]),
    ];
    const uncovered = uncoveredPeerFailures(results, 'axe-core');
    expect(uncovered.map((u) => u.verdict.target.snippet)).toEqual([EMAIL]);
    expect(uncovered[0]?.dissent).toEqual([]);
  });

  it('adds nothing when the reported findings already cover every peer failure', () => {
    const results = [
      result('axe-core', [verdict('axe-core', 'failed', CITY), verdict('axe-core', 'failed', TEL)]),
      result('alfa', [verdict('alfa', 'failed', TEL), verdict('alfa', 'failed', CITY)]),
    ];
    expect(uncoveredPeerFailures(results, 'axe-core')).toEqual([]);
  });

  it('counts identical elements rather than collapsing them', () => {
    // Two copies of the same field. The routed engine failed one; the peer failed both.
    const results = [
      result('axe-core', [verdict('axe-core', 'failed', CITY)]),
      result('marlo', [verdict('marlo', 'failed', CITY), verdict('marlo', 'failed', CITY)]),
      result('alfa', [verdict('alfa', 'failed', CITY), verdict('alfa', 'failed', CITY)]),
    ];
    const uncovered = uncoveredPeerFailures(results, 'axe-core');
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0]?.verdict.engine).toBe('marlo');
  });

  it('reports every copy when the routed engine failed none of them', () => {
    const results = [
      result('axe-core', []),
      result('marlo', [verdict('marlo', 'failed', CITY), verdict('marlo', 'failed', CITY)]),
    ];
    expect(uncoveredPeerFailures(results, 'axe-core')).toHaveLength(2);
  });

  it('never guesses at evidence it cannot identify, and never consults engines that did not run', () => {
    const results = [
      result('axe-core', [verdict('axe-core', 'failed', CITY)]),
      result('marlo', [verdict('marlo', 'failed', 'a text node')]),
      result('htmlcs', [verdict('htmlcs', 'failed', TEL)], 'error'),
      result('alfa', [verdict('alfa', 'failed', TEL)], 'unsupported'),
    ];
    expect(uncoveredPeerFailures(results, 'axe-core')).toEqual([]);
  });

  it('counts a failure located at an attribute as covering the element that carries it', () => {
    // Alfa locates ARIA attribute rules at the attribute; axe-core and Marlo at the element.
    const link = '<a href="/cart" aria-checked="true">Cart</a>';
    const results = [
      result('alfa', [verdict('alfa', 'failed', 'aria-checked="true"')]),
      result('axe-core', [verdict('axe-core', 'failed', link)]),
      result('marlo', [verdict('marlo', 'failed', link)]),
    ];
    expect(uncoveredPeerFailures(results, 'alfa')).toEqual([]);
  });

  it('covers only one element per attribute, and only one with that exact value', () => {
    const results = [
      result('alfa', [verdict('alfa', 'failed', 'aria-required="yes"')]),
      result('marlo', [
        verdict('marlo', 'failed', '<input aria-required="yes" name="a">'),
        verdict('marlo', 'failed', '<input aria-required="yes" name="b">'),
        verdict('marlo', 'failed', '<input aria-required="no" name="c">'),
      ]),
    ];
    expect(uncoveredPeerFailures(results, 'alfa').map((u) => u.verdict.target.snippet)).toEqual([
      '<input aria-required="yes" name="b">',
      '<input aria-required="no" name="c">',
    ]);
  });

  it('reports a page-level defect once, wherever each engine located it', () => {
    const results = [
      result('alfa', [verdict('alfa', 'failed', '<html>')]),
      result('htmlcs', [verdict('htmlcs', 'failed', '<head> <meta charset="utf-8">')]),
    ];
    expect(uncoveredPeerFailures(results, 'alfa')).toEqual([]);
  });

  it('still reports a page-level failure when the reporting engine failed nothing', () => {
    const results = [
      result('alfa', [verdict('alfa', 'passed', '<html>')]),
      result('htmlcs', [verdict('htmlcs', 'failed', '<head>')]),
    ];
    expect(uncoveredPeerFailures(results, 'alfa')).toHaveLength(1);
  });

  it('treats a reporter missing from the results as having covered nothing', () => {
    const results = [result('marlo', [verdict('marlo', 'failed', TEL)])];
    expect(uncoveredPeerFailures(results, 'axe-core')).toHaveLength(1);
  });

  it('only ever adds: every peer failure is either covered or returned', () => {
    const snippets = [CITY, TEL, EMAIL, 'not markup'];
    const engines: EngineId[] = ['marlo', 'axe-core', 'alfa', 'htmlcs'];
    const arbitraryResult = (engine: EngineId) =>
      fc
        .array(
          fc.record({
            outcome: fc.constantFrom<Outcome>('failed', 'passed', 'cantTell'),
            snippet: fc.constantFrom(...snippets),
          }),
          { maxLength: 6 },
        )
        .map((vs) =>
          result(
            engine,
            vs.map((v) => verdict(engine, v.outcome, v.snippet)),
          ),
        );
    fc.assert(
      fc.property(
        fc.tuple(...engines.map(arbitraryResult)),
        fc.constantFrom(...engines),
        (results, reporter) => {
          const uncovered = uncoveredPeerFailures(results, reporter);
          const count = (engine: EngineId | null, snippet: string) =>
            results
              .filter((r) => engine === null || r.engine === engine)
              .flatMap((r) => r.verdicts)
              .filter(
                (v) =>
                  v.outcome === 'failed' && elementKey(v.target.snippet) === elementKey(snippet),
              ).length;
          for (const snippet of [CITY, TEL, EMAIL]) {
            const reported = count(reporter, snippet);
            const added = uncovered.filter((u) => u.verdict.target.snippet === snippet).length;
            // Every peer's failures on this element are matched by what was reported or added.
            for (const peer of engines.filter((e) => e !== reporter)) {
              if (count(peer, snippet) > reported + added) return false;
            }
            // And nothing is added beyond the largest number of copies any peer failed.
            const most = Math.max(
              0,
              ...engines.filter((e) => e !== reporter).map((e) => count(e, snippet)),
            );
            if (added > Math.max(0, most - reported)) return false;
          }
          return true;
        },
      ),
    );
  });
});
