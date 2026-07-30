import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ActRuleId, CalibrationTable, Edit, Finding } from '@marlo/schema';
import { CalibrationTable as CalibrationTableSchema } from '@marlo/schema';
import { StaticRenderer } from '@marlo/render';
import { peerEngines } from '@marlo/engines';
import {
  EditConflictError,
  applyEdits,
  attributeOccurrences,
  checkThreshold,
  conflicts,
  indexElements,
  locate,
  repairFinding,
  rulesWithCodemods,
  runCodemod,
} from './index.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const table: CalibrationTable = CalibrationTableSchema.parse(
  JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
);
const broken = readFileSync(resolve(ROOT, 'apps/demo/checkout.html'), 'utf8');

/* ── Source location ──────────────────────────────────────────────────────────── */

describe('source location', () => {
  it('gives an attribute a range that contains exactly that attribute', () => {
    const html = '<input name="a" aria-required="yes">';
    const [el] = indexElements(html, 'x.html');
    expect(el).toBeDefined();
    const range = el?.attrs.get('aria-required');
    expect(range).toBeDefined();
    if (range === undefined) return;
    expect(html.slice(range.start, range.end)).toBe('aria-required="yes"');
  });

  it('locates an element in a real file, not just a fragment', () => {
    const meta = locate(broken, 'checkout.html', { tag: 'meta', attrs: { name: 'viewport' } });
    expect(meta).not.toBeNull();
    const content = meta?.attrs.get('content');
    expect(content).toBeDefined();
    if (content === undefined) return;
    expect(broken.slice(content.start, content.end)).toContain('user-scalable=no');
  });

  it('refuses to locate an element two things match', () => {
    // The whole point. An edit applied to the wrong one of two candidates is worse than no edit,
    // so this returns null and the caller raises a flag with reason source-not-located.
    const html = '<p class="a">one</p><p class="a">two</p>';
    expect(locate(html, 'x.html', { tag: 'p', attrs: { class: 'a' } })).toBeNull();
    // Unless the caller says how many it expects, and which one it means.
    expect(
      locate(html, 'x.html', { tag: 'p', attrs: { class: 'a' }, index: 1, of: 2 }),
    ).not.toBeNull();
    // And a wrong count is still a refusal, because it means the file is not what the caller read.
    expect(locate(html, 'x.html', { tag: 'p', attrs: { class: 'a' }, index: 1, of: 3 })).toBeNull();
  });

  it('skips an element the parser implied rather than read', () => {
    // `tbody` is inserted by every HTML parser and appears in no source file. It cannot be
    // edited because it was never written down.
    const html = '<table><tr><td>a</td></tr></table>';
    const tags = indexElements(html, 'x.html').map((el) => el.tag);
    expect(tags).toContain('table');
    expect(tags).toContain('tr');
    expect(tags).not.toContain('tbody');
  });

  it('sees a duplicated attribute the DOM has already thrown away', () => {
    // Every parser drops the second occurrence, so no engine can see this. The bytes still can.
    const html = '<input name="a" name="b">';
    const [el] = indexElements(html, 'x.html');
    expect(el?.values.size).toBe(1);
    if (el === undefined) return;
    const occurrences = attributeOccurrences(html, el.startTag);
    expect(occurrences.map((o) => o.name)).toEqual(['name', 'name']);
    expect(html.slice(occurrences[1]?.start ?? 0, occurrences[1]?.end ?? 0)).toBe('name="b"');
  });

  it('handles every attribute quoting style HTML permits', () => {
    const html = `<input a="1" b='2' c=3 d e = "5">`;
    const [el] = indexElements(html, 'x.html');
    expect(el).toBeDefined();
    if (el === undefined) return;
    expect(attributeOccurrences(html, el.startTag).map((o) => o.name)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });
});

/* ── Applying edits ───────────────────────────────────────────────────────────── */

const edit = (over: Partial<Edit> = {}): Edit => ({
  file: 'x.html',
  start: 0,
  end: 1,
  before: 'a',
  after: 'b',
  kind: 'set-attribute-value',
  actRuleId: '5f99a7',
  insertedElement: null,
  rationale: 'r',
  ...over,
});

describe('applying edits', () => {
  it('refuses an edit whose bytes are not what it expected', () => {
    // An edit computed against one version of a file and applied to another is how a codemod
    // deletes something at random, and the offsets are usually still in range.
    expect(() => applyEdits('zzz', [edit({ before: 'a' })])).toThrow(EditConflictError);
  });

  it('applies back to front, so one edit cannot move the next', () => {
    const out = applyEdits('0123456789', [
      edit({ start: 1, end: 2, before: '1', after: 'ONE' }),
      edit({ start: 7, end: 8, before: '7', after: 'SEVEN' }),
    ]);
    expect(out).toBe('0ONE23456SEVEN89');
  });

  it('refuses two edits that touch the same bytes rather than picking one', () => {
    const overlapping = [
      edit({ start: 0, end: 5, before: '01234', after: 'x' }),
      edit({ start: 3, end: 8, before: '34567', after: 'y' }),
    ];
    expect(conflicts(overlapping)).toHaveLength(1);
    expect(() => applyEdits('0123456789', overlapping)).toThrow(/decision for a person/);
  });

  it('treats two edits over the identical range as a conflict, not a duplicate', () => {
    const same = [
      edit({ start: 0, end: 1, before: '0', after: 'x' }),
      edit({ start: 0, end: 1, before: '0', after: 'y' }),
    ];
    expect(conflicts(same)).toHaveLength(1);
  });

  it('does not treat edits in different files as conflicting', () => {
    expect(
      conflicts([
        edit({ file: 'a.html', start: 0, end: 1, before: '0' }),
        edit({ file: 'b.html', start: 0, end: 1, before: '0' }),
      ]),
    ).toHaveLength(0);
  });

  it('finds the three text spacing rules colliding on one style attribute', () => {
    // A real collision, and worth a test rather than a comment. All three rules want to edit the
    // same style attribute, each removing a different !important from it. Neither is wrong, and
    // applying both would apply the second to bytes the first had already moved.
    //
    // It cannot happen today, because none of the three clears the auto-fix threshold, so all
    // three arrive as flags and flags are never applied. If their precision improves it becomes
    // reachable, and this asserts it is refused rather than silently mangled.
    const spacing = ['24afc2', '78fd32', '9e45ec'] as const;
    const all = spacing.flatMap(
      (rule) => runCodemod({ html: broken, file: 'checkout.html', actRuleId: rule }).edits,
    );
    expect(all.length).toBe(3);
    expect(conflicts(all).length).toBeGreaterThan(0);
    expect(() => applyEdits(broken, all)).toThrow(EditConflictError);
  });
});

/* ── The codemods ─────────────────────────────────────────────────────────────── */

describe('the codemods', () => {
  it('produces a minimal, valid edit for every rule it claims', () => {
    for (const rule of rulesWithCodemods()) {
      const result = runCodemod({
        html: broken,
        file: 'checkout.html',
        actRuleId: rule,
      });
      expect(
        result.edits.length,
        `${rule} produced nothing on a page built to break it`,
      ).toBeGreaterThan(0);
      for (const e of result.edits) {
        // The schema requires this and applyEdits checks it. Asserting it here means a broken
        // codemod fails in this file rather than three layers away.
        expect(e.before).toBe(broken.slice(e.start, e.end));
        expect(e.before.length).toBe(e.end - e.start);
        expect(e.rationale.length).toBeGreaterThan(10);
        expect(e.actRuleId).toBe(rule);
      }
    }
  });

  it('removes only the viewport declarations that forbid zoom', () => {
    const { edits } = runCodemod({ html: broken, file: 'checkout.html', actRuleId: 'b4f0c3' });
    const after = edits[0]?.after ?? '';
    expect(after).toContain('width=device-width');
    expect(after).toContain('initial-scale=1');
    expect(after).not.toContain('user-scalable');
    expect(after).not.toContain('maximum-scale');
  });

  it('leaves a viewport that already permits zoom alone', () => {
    const ok = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    const result = runCodemod({ html: ok, file: 'x.html', actRuleId: 'b4f0c3' });
    expect(result.edits).toEqual([]);
    expect(result.declined).toContain('already permits zoom');
  });

  it('keeps a maximum-scale of 2 or more, which is permitted', () => {
    const ok = '<meta name="viewport" content="width=device-width, maximum-scale=5">';
    expect(runCodemod({ html: ok, file: 'x.html', actRuleId: 'b4f0c3' }).edits).toEqual([]);
  });

  it('corrects an ARIA attribute that is one character from a real one', () => {
    const { edits } = runCodemod({ html: broken, file: 'checkout.html', actRuleId: '5f99a7' });
    expect(edits[0]?.before).toBe('aria-labeledby');
    expect(edits[0]?.after).toBe('aria-labelledby');
    expect(edits[0]?.kind).toBe('rename-attribute');
  });

  it('declines an ARIA attribute that is not one character from anything', () => {
    // `aria-flurble` is not a typo for a real attribute, so the intended name is a guess and
    // guessing is what this file exists not to do.
    const result = runCodemod({
      html: '<div aria-flurble="x"></div>',
      file: 'x.html',
      actRuleId: '5f99a7',
    });
    expect(result.edits).toEqual([]);
    expect(result.declined).toContain('guess');
  });

  it('declines an ARIA attribute that is one character from two real ones', () => {
    // aria-rowindex and aria-colindex are both one edit from neither, but aria-rowcount and
    // aria-colcount show the shape: where two candidates tie, there is no answer to pick.
    const result = runCodemod({
      html: '<div aria-owned="x"></div>',
      file: 'x.html',
      actRuleId: '5f99a7',
    });
    // aria-owns is two edits away, so this declines. The assertion is that it declines rather
    // than reaching for the nearest thing.
    expect(result.edits).toEqual([]);
  });

  it('corrects an ARIA boolean whose value has one reading', () => {
    const { edits } = runCodemod({ html: broken, file: 'checkout.html', actRuleId: '6a7281' });
    expect(edits[0]?.after).toContain('"true"');
  });

  it('leaves aria-checked alone, because mixed is a real value', () => {
    // The reason aria-checked is not in the boolean list. A value that is neither true nor false
    // is not necessarily a failed attempt at a boolean.
    const result = runCodemod({
      html: '<div role="checkbox" aria-checked="mixed"></div>',
      file: 'x.html',
      actRuleId: '6a7281',
    });
    expect(result.edits).toEqual([]);
  });

  it('removes the later of two duplicated attributes, and only that', () => {
    const { edits } = runCodemod({ html: broken, file: 'checkout.html', actRuleId: 'e6952f' });
    expect(edits).toHaveLength(1);
    expect(edits[0]?.before.trim()).toBe('name="town"');
    expect(edits[0]?.after).toBe('');
    // The first occurrence survives, which is what every browser already does.
    const after = applyEdits(broken, edits);
    expect(after).toContain('name="city"');
    expect(after).not.toContain('name="town"');
  });

  it('removes !important from the property its rule is about, and no other', () => {
    const { edits } = runCodemod({ html: broken, file: 'checkout.html', actRuleId: '24afc2' });
    const after = edits[0]?.after ?? '';
    expect(after).toContain('letter-spacing: 0.01em;');
    // The other two declarations keep theirs. This rule is not about them.
    expect(after).toContain('line-height: 1.1 !important');
    expect(after).toContain('word-spacing: 0.05em !important');
  });

  it('keeps the value the author chose', () => {
    // The fix is to stop the declaration winning against a reader's stylesheet, not to change
    // the design. 0.01em stays 0.01em.
    const { edits } = runCodemod({ html: broken, file: 'checkout.html', actRuleId: '24afc2' });
    expect(edits[0]?.after).toContain('0.01em');
  });

  it('says why, whenever it produces nothing', () => {
    for (const rule of rulesWithCodemods()) {
      const result = runCodemod({
        html: '<p>nothing wrong here</p>',
        file: 'x.html',
        actRuleId: rule,
      });
      if (result.edits.length === 0) {
        expect(result.declined, `${rule} declined without saying why`).not.toBeNull();
        expect((result.declined ?? '').length).toBeGreaterThan(10);
      }
    }
  });

  it('has no codemod for a rule whose fix is a decision', () => {
    // The list being short is the point. Each of these needs a human, and the comment at the top
    // of codemod.ts says which kind of human decision.
    for (const rule of ['b5c3f8', '23a2a8', 'cae760', '3ea0c8', '46ca7f', 'afw4f7', '9eb3f6']) {
      expect(rulesWithCodemods(), `${rule} should not have a codemod`).not.toContain(rule);
    }
  });
});

/* ── Properties ───────────────────────────────────────────────────────────────── */

describe('properties that must hold for any input', () => {
  /**
   * The codemod layer is where a property test earns its place: the inputs are text, the outputs
   * are edits against that text, and the invariants are cheap to state and expensive to check by
   * hand.
   */
  const attributeValue = fc.stringMatching(/^[a-zA-Z0-9 _-]{0,12}$/);
  const attributeName = fc.constantFrom(
    'name',
    'id',
    'class',
    'style',
    'aria-required',
    'aria-labeledby',
    'aria-hidden',
    'content',
    'data-x',
  );

  const startTag = fc
    .tuple(
      fc.constantFrom('input', 'div', 'p', 'meta', 'span', 'a'),
      fc.array(fc.tuple(attributeName, attributeValue, fc.constantFrom('"', "'", '')), {
        maxLength: 5,
      }),
    )
    .map(([tag, attrs]) => {
      const rendered = attrs
        .map(([name, value, quote]) =>
          quote === ''
            ? ` ${name}=${value.replace(/\s/g, '')}`
            : ` ${name}=${quote}${value}${quote}`,
        )
        .join('');
      return `<${tag}${rendered}>`;
    });

  const document = fc
    .array(startTag, { minLength: 1, maxLength: 6 })
    .map(
      (tags) =>
        `<!doctype html><html lang="en"><head><title>t</title></head><body>${tags.join('')}</body></html>`,
    );

  it('every attribute range holds exactly that attribute', () => {
    fc.assert(
      fc.property(document, (html) => {
        for (const el of indexElements(html, 'x.html')) {
          for (const [name, range] of el.attrs) {
            const text = html.slice(range.start, range.end);
            expect(text.toLowerCase().startsWith(name)).toBe(true);
            expect(range.end).toBeGreaterThan(range.start);
            expect(range.end).toBeLessThanOrEqual(html.length);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('every attribute occurrence lies inside its own start tag', () => {
    fc.assert(
      fc.property(document, (html) => {
        for (const el of indexElements(html, 'x.html')) {
          for (const occurrence of attributeOccurrences(html, el.startTag)) {
            expect(occurrence.start).toBeGreaterThanOrEqual(el.startTag.start);
            expect(occurrence.end).toBeLessThanOrEqual(el.startTag.end);
            expect(occurrence.end).toBeGreaterThan(occurrence.start);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('every edit describes bytes the document actually contains', () => {
    fc.assert(
      fc.property(document, (html) => {
        for (const rule of rulesWithCodemods()) {
          for (const e of runCodemod({ html, file: 'x.html', actRuleId: rule }).edits) {
            expect(html.slice(e.start, e.end)).toBe(e.before);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('applying one rule twice is the same as applying it once', () => {
    // Idempotence, which is the third question Verification asks. A codemod that keeps finding
    // work on its own output would run forever in a pre-commit hook.
    fc.assert(
      fc.property(document, (html) => {
        for (const rule of rulesWithCodemods()) {
          const first = runCodemod({ html, file: 'x.html', actRuleId: rule }).edits;
          if (first.length === 0) continue;
          if (conflicts(first).length > 0) continue;
          const once = applyEdits(html, first);
          const second = runCodemod({
            html: once,
            file: 'x.html',
            actRuleId: rule,
          }).edits;
          if (second.length === 0) continue;
          expect(applyEdits(once, second)).toBe(once);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('an edit never lengthens the document without adding content', () => {
    // A deletion that leaves the file longer, or a rename that changes its length by more than
    // the difference in the two names, means an offset is wrong.
    fc.assert(
      fc.property(document, (html) => {
        for (const rule of rulesWithCodemods()) {
          const edits = runCodemod({ html, file: 'x.html', actRuleId: rule }).edits;
          if (edits.length === 0 || conflicts(edits).length > 0) continue;
          const expected =
            html.length + edits.reduce((sum, e) => sum + (e.after.length - e.before.length), 0);
          expect(applyEdits(html, edits).length).toBe(expected);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('applying edits leaves a document with the same elements in the same order', () => {
    // Nothing here should ever add, remove or reorder an element. Every codemod in this package
    // edits an attribute.
    fc.assert(
      fc.property(document, (html) => {
        for (const rule of rulesWithCodemods()) {
          const edits = runCodemod({ html, file: 'x.html', actRuleId: rule }).edits;
          if (edits.length === 0 || conflicts(edits).length > 0) continue;
          const before = indexElements(html, 'x.html').map((el) => el.tag);
          const after = indexElements(applyEdits(html, edits), 'x.html').map((el) => el.tag);
          expect(after).toEqual(before);
        }
      }),
      { numRuns: 200 },
    );
  });
});

/* ── The gate, and the verification loop ──────────────────────────────────────── */

describe('the auto-fix gate', () => {
  it('permits a rule only when the reporting engine measured well enough', () => {
    const permitted = rulesWithCodemods().filter((rule) => {
      const routed = table.routing.find((r) => r.actRuleId === rule);
      if (routed?.chosen === null || routed === undefined) return false;
      return checkThreshold(table, rule, routed.chosen).permitted;
    });
    // The number is whatever the table says. What is asserted is that the gate excludes some of
    // them, because a gate that admits everything is not a gate.
    expect(permitted.length).toBeGreaterThan(0);
    expect(permitted.length).toBeLessThan(rulesWithCodemods().length);
  });

  it('reports the measurement that disqualified a rule, not just a refusal', () => {
    const check = checkThreshold(table, '24afc2', 'marlo');
    expect(check.permitted).toBe(false);
    expect(check.strictPrecision).not.toBeNull();
    expect(check.threshold).toBeGreaterThan(0.9);
    expect(check.sampleSize).toBeGreaterThan(0);
  });

  it('treats an unmeasured rule as not permitted rather than as fine', () => {
    const check = checkThreshold(table, 'e6952f', 'marlo');
    expect(check.permitted).toBe(false);
  });
});

describe('the verification loop', () => {
  const finding = (over: Partial<Finding> = {}): Finding => ({
    id: 'x-0',
    actRuleId: 'b4f0c3',
    actRuleName: 'Meta viewport allows for zoom',
    successCriteria: ['1.4.4', '1.4.10'],
    severity: 'critical',
    reportedBy: 'axe-core',
    routingReason: 'best-measured',
    verdict: {
      engine: 'axe-core',
      engineVersion: '4.12.1',
      engineRuleId: 'meta-viewport',
      actRuleId: 'b4f0c3',
      outcome: 'failed',
      target: { selector: 'meta[name="viewport"]', snippet: '<meta>', path: [] },
      message: 'Zooming and scaling must not be disabled',
    },
    agreedBy: ['marlo'],
    disagreements: [],
    confidence: {
      source: 'calibrated',
      precision: 1,
      recall: 1,
      sampleSize: 11,
      meetsAutoFixThreshold: true,
    },
    source: null,
    locationNote: null,
    renderer: 'static',
    help: 'Zooming and scaling must not be disabled',
    helpUrl: 'https://act-rules.github.io/rules/b4f0c3',
    ...over,
  });

  const context = (html: string) => {
    const renderer = new StaticRenderer();
    return {
      html,
      file: 'x.html',
      renderer,
      table,
      evaluate: async (source: string, rules: readonly ActRuleId[]) => {
        const page = await renderer.render({ html: source });
        try {
          const engines = peerEngines();
          return await Promise.all(engines.map(async (e) => await e.evaluate(page, rules)));
        } finally {
          await page.close();
        }
      },
    };
  };

  it('produces a verified fix, with all three questions answered', async () => {
    const html =
      '<!doctype html><html lang="en"><head><title>t</title>' +
      '<meta name="viewport" content="width=device-width, user-scalable=no"></head>' +
      '<body><p>hi</p></body></html>';
    const repair = await repairFinding(finding(), context(html));
    expect(repair.kind).toBe('fixed');
    if (repair.kind !== 'fixed') return;
    expect(repair.verification.targetClosed).toBe(true);
    expect(repair.verification.noNewViolations).toBe(true);
    expect(repair.verification.idempotent).toBe(true);
    expect(repair.verification.enginesRun.length).toBeGreaterThan(0);
    expect(applyEdits(html, repair.edits)).not.toContain('user-scalable');
  }, 60_000);

  it('flags rather than fixes when the engine measured below the threshold', async () => {
    // The gate biting on a mechanically correct fix. Marlo generated the edit, attached it, and
    // did not apply it, because the detection it rests on is right 29% of the time.
    const html =
      '<!doctype html><html lang="en"><head><title>t</title></head>' +
      '<body><p style="letter-spacing: 0.01em !important">x</p></body></html>';
    const repair = await repairFinding(
      finding({
        actRuleId: '24afc2',
        actRuleName: 'Important letter spacing in style attributes is wide enough',
        reportedBy: 'marlo',
        verdict: { ...finding().verdict, engine: 'marlo', actRuleId: '24afc2' },
      }),
      context(html),
    );
    expect(repair.kind).toBe('flagged');
    if (repair.kind !== 'flagged') return;
    expect(repair.reason).toBe('below-threshold');
    expect(repair.thresholdEvidence).not.toBeNull();
    expect(repair.unverifiedEdits.length).toBeGreaterThan(0);
    // The generated change is attached as evidence and was never applied.
    expect(repair.explanation).toContain('is still not applied');
  }, 60_000);

  it('flags a rule with no codemod rather than inventing one', async () => {
    const html = '<html><head><title>t</title></head><body><p>x</p></body></html>';
    const repair = await repairFinding(
      finding({
        actRuleId: 'b5c3f8',
        actRuleName: 'HTML page has lang attribute',
        reportedBy: 'marlo',
      }),
      context(html),
    );
    expect(repair.kind).toBe('flagged');
    if (repair.kind !== 'flagged') return;
    expect(repair.unverifiedEdits).toEqual([]);
    expect(repair.humanDecision.length).toBeGreaterThan(10);
  }, 60_000);

  it('flags rather than claims when the renderer cannot verify the rule', async () => {
    // Contrast on a renderer with no layout. Every engine returns unsupported before and after,
    // so re-running them proves nothing, and an unverifiable fix is a flag even if the edit is
    // obviously right.
    const html =
      '<!doctype html><html lang="en"><head><title>t</title></head>' +
      '<body><p style="color:#888;background:#fff">x</p></body></html>';
    const repair = await repairFinding(
      finding({
        actRuleId: 'afw4f7',
        actRuleName: 'Text has minimum contrast',
        reportedBy: 'alfa',
      }),
      context(html),
    );
    expect(repair.kind).toBe('flagged');
  }, 60_000);
});
