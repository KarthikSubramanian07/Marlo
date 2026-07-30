import { afterEach, describe, expect, it } from 'vitest';
import type { ActRuleId } from '@marlo/schema';
import { isPublishedRule } from '@marlo/act';
import { StaticRenderer } from '@marlo/render';

import {
  ALFA_MAPPING,
  AXE_MAPPING,
  AlfaEngine,
  AxeEngine,
  HTMLCS_MAPPING,
  HtmlcsEngine,
  buildMapping,
  collapseOutcome,
  describeSelector,
  normaliseCode,
  peerEngines,
  truncateSnippet,
} from './index.js';
import { asWindow } from './dom.js';

const renderer = new StaticRenderer();
afterEach(async () => {
  await renderer.dispose();
});

const MAPPINGS = [
  { name: 'axe-core', mapping: AXE_MAPPING },
  { name: 'alfa', mapping: ALFA_MAPPING },
  { name: 'htmlcs', mapping: HTMLCS_MAPPING },
];

describe('every mapping entry is well formed', () => {
  for (const { name, mapping } of MAPPINGS) {
    describe(name, () => {
      it('only claims ACT rules that exist', () => {
        // A mapping to an identifier the corpus does not contain would produce a
        // calibration entry for a rule nobody can look up.
        for (const entry of mapping.entries) {
          expect(isPublishedRule(entry.actId), `${entry.engineRuleId} -> ${entry.actId}`).toBe(
            true,
          );
        }
      });

      it('explains every entry', () => {
        // An entry without a reason is an assertion, and this whole package exists
        // because assertions about engine equivalence are what everybody makes and
        // nobody publishes.
        for (const entry of mapping.entries) {
          expect(entry.note.length, `${entry.engineRuleId} -> ${entry.actId}`).toBeGreaterThan(25);
        }
      });

      it('uses a declared mapping kind', () => {
        for (const entry of mapping.entries) {
          expect(['exact', 'partial', 'superset']).toContain(entry.kind);
        }
      });

      it('has no duplicate engine-rule to ACT-rule pairs', () => {
        const pairs = mapping.entries.map((e) => `${e.engineRuleId}=>${e.actId}`);
        expect(new Set(pairs).size).toBe(pairs.length);
      });

      it('claims at least one rule', () => {
        expect(mapping.claimedRules.size).toBeGreaterThan(0);
      });
    });
  }

  it('gives axe the largest table, since it is the only one derived by measurement', () => {
    // The alfa and htmlcs tables are documentation matches pending harness
    // confirmation. If one of them overtakes axe without a discovery run behind it,
    // somebody has been guessing.
    expect(AXE_MAPPING.entries.length).toBeGreaterThan(ALFA_MAPPING.entries.length);
    expect(AXE_MAPPING.entries.length).toBeGreaterThan(HTMLCS_MAPPING.entries.length);
  });

  it('marks every unmeasured Alfa entry as partial rather than exact', () => {
    // A documentation match is not a measurement. Claiming `exact` on the strength of
    // matching prose is exactly the overstatement this project argues against.
    for (const entry of ALFA_MAPPING.entries) {
      expect(entry.kind, `${entry.engineRuleId} claims ${entry.kind}`).toBe('partial');
    }
  });
});

describe('the mapping index works both ways', () => {
  it('finds engine rules for an ACT rule', () => {
    const forLinkName = AXE_MAPPING.actToEngine('c487ae').map((e) => e.engineRuleId);
    // Several engine rules per ACT rule is normal: axe splits by element type to give
    // better remediation advice, which ACT's own mapping guidance anticipates.
    expect(forLinkName).toContain('link-name');
    expect(forLinkName.length).toBeGreaterThan(1);
  });

  it('finds ACT rules for an engine rule', () => {
    // One engine rule serving two ACT rules, because the two ACT rules differ only in
    // an exception.
    const refresh = AXE_MAPPING.engineToAct('meta-refresh').map((e) => e.actId);
    expect(refresh.sort()).toEqual(['bc659a', 'bisz58']);
  });

  it('returns empty rather than undefined for an unknown lookup', () => {
    expect(AXE_MAPPING.actToEngine('zzzzzz')).toEqual([]);
    expect(AXE_MAPPING.engineToAct('no-such-rule')).toEqual([]);
  });

  it('builds claimedRules from the entries', () => {
    const mapping = buildMapping([
      { engineRuleId: 'a', actId: 'b5c3f8', kind: 'exact', note: 'x'.repeat(30) },
      { engineRuleId: 'b', actId: 'b5c3f8', kind: 'partial', note: 'x'.repeat(30) },
    ]);
    expect([...mapping.claimedRules]).toEqual(['b5c3f8']);
  });
});

describe('collapseOutcome', () => {
  it('lets a single failure win', () => {
    expect(collapseOutcome([{ outcome: 'passed' }, { outcome: 'failed' }])).toBe('failed');
  });

  it('lets cantTell survive contact with a pass', () => {
    // Promoting uncertainty to `passed` because some other element passed is how a
    // tool reports clean on a page it did not understand.
    expect(collapseOutcome([{ outcome: 'passed' }, { outcome: 'cantTell' }])).toBe('cantTell');
  });

  it('ranks failed above cantTell', () => {
    expect(collapseOutcome([{ outcome: 'cantTell' }, { outcome: 'failed' }])).toBe('failed');
  });

  it('treats nothing at all as inapplicable', () => {
    expect(collapseOutcome([])).toBe('inapplicable');
    expect(collapseOutcome([{ outcome: 'inapplicable' }])).toBe('inapplicable');
  });

  it('reports passed only when something applied and nothing was wrong', () => {
    expect(collapseOutcome([{ outcome: 'passed' }, { outcome: 'inapplicable' }])).toBe('passed');
  });
});

describe('helpers', () => {
  it('truncates a snippet and collapses whitespace', () => {
    expect(truncateSnippet('<p>\n  a   b\n</p>')).toBe('<p> a b </p>');
    expect(truncateSnippet('x'.repeat(500)).length).toBe(240);
    expect(truncateSnippet('x'.repeat(500)).endsWith('…')).toBe(true);
  });

  it('normalises an HTML CodeSniffer code to criterion and technique', () => {
    expect(normaliseCode('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37')).toBe('1_1_1.H37');
    expect(normaliseCode('WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.Empty')).toBe(
      '4_1_2.H91.A.Empty',
    );
    // A code that does not match the shape comes back untouched rather than mangled.
    expect(normaliseCode('short.code')).toBe('short.code');
  });

  it('refuses a handle that is not a DOM window, loudly', () => {
    // An adapter handed the wrong handle should say so. The alternative is a report
    // full of `inapplicable` that reads as a clean page.
    expect(() => asWindow({}, 'axe-core')).toThrow(/needs a DOM window/);
    expect(() => asWindow(null, 'axe-core')).toThrow(TypeError);
  });

  it('describes a selector a human can use', () => {
    const el = (tag: string, attrs: Record<string, string>) => ({
      tagName: tag,
      outerHTML: '',
      getAttribute: (n: string) => attrs[n] ?? null,
    });
    expect(describeSelector(el('DIV', { id: 'main' }))).toBe('div#main');
    expect(describeSelector(el('DIV', { class: 'card wide' }))).toBe('div.card');
    expect(describeSelector(el('DIV', {}))).toBe('div');
    expect(describeSelector(el('DIV', { class: '   ' }))).toBe('div');
  });
});

describe('the adapters run against a real page', () => {
  // The point of these is that the engines actually work in this environment, which
  // was the spike that decided the architecture. If any of them stops running, the
  // calibration table quietly loses a column.
  const BROKEN =
    '<!DOCTYPE html><html><head></head><body>' +
    '<img src="a.png">' +
    '<a href="#x"></a>' +
    '<input type="text">' +
    '<div role="nonsense" aria-bogus="1"></div>' +
    '<iframe src="b.html"></iframe>' +
    '</body></html>';

  it('axe-core reports failures and names its version', async () => {
    const page = await renderer.render({ html: BROKEN });
    const engine = new AxeEngine();
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+/);

    const requested: ActRuleId[] = ['b5c3f8', '23a2a8', 'c487ae', 'e086e5', '674b10', 'cae760'];
    const report = await engine.evaluate(page, requested);

    expect(report.engine).toBe('axe-core');
    expect(report.renderer).toBe('static');
    // Every requested rule appears, whatever happened.
    expect(report.results.map((r) => r.actRuleId).sort()).toEqual([...requested].sort());
    expect(report.results.every((r) => r.status !== 'error')).toBe(true);

    const failed = report.results.filter((r) => r.verdicts.some((v) => v.outcome === 'failed'));
    expect(failed.length).toBeGreaterThan(2);
    await page.close();
  });

  it('alfa reports outcomes in ACT vocabulary and names its version', async () => {
    const page = await renderer.render({ html: BROKEN });
    const engine = new AlfaEngine();
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+/);

    const report = await engine.evaluate(page, ['b5c3f8', '23a2a8', 'c487ae']);
    expect(report.engine).toBe('alfa');
    // Alfa is the engine whose vocabulary needs no translation, so a verdict outside
    // ACT's four would mean the narrowing guard is doing nothing.
    for (const result of report.results) {
      if (result.status !== 'ok') continue;
      for (const verdict of result.verdicts) {
        expect(['passed', 'failed', 'cantTell', 'inapplicable']).toContain(verdict.outcome);
      }
    }
    await page.close();
  });

  it('html_codesniffer reports messages and names its version', async () => {
    const page = await renderer.render({ html: BROKEN });
    const engine = new HtmlcsEngine();
    expect(engine.version).toMatch(/^\d+\.\d+\.\d+/);

    const report = await engine.evaluate(page, ['b5c3f8', '2779a5', '23a2a8']);
    expect(report.engine).toBe('htmlcs');
    expect(report.results).toHaveLength(3);
    await page.close();
  });

  it('gives three peer engines, and Marlo is not among them', async () => {
    const peers = peerEngines();
    expect(peers.map((e) => e.id).sort()).toEqual(['alfa', 'axe-core', 'htmlcs']);
    // DECISIONS.md D-008: Marlo's own engine lives in @marlo/rules, which cannot
    // import this package, so its column is produced without ever seeing a peer.
    expect(peers.map((e) => e.id)).not.toContain('marlo');
    await Promise.resolve();
  });
});

describe('silence is never a pass', () => {
  it('reports a rule the engine does not implement as unsupported', async () => {
    const page = await renderer.render({ html: '<p>a</p>' });
    // 2t702h is a published ACT rule no adapter claims, and it has no official test
    // cases either.
    const report = await new AxeEngine().evaluate(page, ['2t702h']);
    const result = report.results[0];
    expect(result?.status).toBe('unsupported');
    expect(result?.verdicts).toEqual([]);
    // Distinct from unsupported-for-lack-of-capability: nothing was missing from the
    // renderer, the engine simply has no opinion.
    expect(result?.missingCapabilities).toEqual([]);
    await page.close();
  });

  it('never omits a requested rule', async () => {
    const page = await renderer.render({ html: '<p>a</p>' });
    const requested: ActRuleId[] = ['b5c3f8', '2t702h', 'afw4f7'];
    for (const engine of peerEngines()) {
      const report = await engine.evaluate(page, requested);
      // An omitted rule reads as a pass to anything counting results, which is the
      // failure the whole capability model exists to prevent.
      expect(report.results.map((r) => r.actRuleId).sort(), engine.id).toEqual(
        [...requested].sort(),
      );
    }
    await page.close();
  });

  it('lists rules the engine implements but was not asked about', async () => {
    // So a reader can tell a rule that was skipped from a rule the engine cannot do.
    const page = await renderer.render({ html: '<p>a</p>' });
    const report = await new AxeEngine().evaluate(page, ['b5c3f8']);
    expect(report.notRequested.length).toBeGreaterThan(10);
    expect(report.notRequested).not.toContain('b5c3f8');
    await page.close();
  });
});

describe('contrast declines rather than guessing, on the static renderer', () => {
  it('never returns failed for a contrast rule with no layout', async () => {
    // The finding from the discovery run, asserted so it cannot regress silently. axe
    // returned `incomplete` on all 19 of afw4f7's official test cases and never
    // `failed`, because happy-dom does not lay out and the colours cannot be resolved.
    // It declined rather than guessing, which is the same conclusion the capability
    // model reaches by declaration.
    const page = await renderer.render({
      html: '<html><body><p style="color:#777;background:#fff">low contrast text</p></body></html>',
    });
    const report = await new AxeEngine().evaluate(page, ['afw4f7']);
    const result = report.results.find((r) => r.actRuleId === 'afw4f7');
    expect(result).toBeDefined();
    if (result?.status !== 'ok') {
      await page.close();
      return;
    }
    expect(result.verdicts.some((v) => v.outcome === 'failed')).toBe(false);
    await page.close();
  });
});
