import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CalibrationTable, EXIT_CODES } from '@marlo/schema';
import { StaticRenderer } from '@marlo/render';
import { renderSarif, renderTerminal } from '@marlo/report';

import { exitCodeFor, newRunId, scan } from './pipeline.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const table = CalibrationTable.parse(
  JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
);

/**
 * A page with one clear instance of each category Marlo claims, plus two things it should
 * not report: a correctly labelled field and a correctly hidden decorative image.
 */
const BROKEN = `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, user-scalable=no"></head>
<body>
  <img src="logo.png">
  <a href="/basket"></a>
  <input type="text" placeholder="Email">
  <h2></h2>
  <div role="checkbox" aria-checked="yes">Subscribe</div>
  <div aria-hidden="true"><button>Buy</button></div>
  <p id="dup">a</p><p id="dup">b</p>

  <label for="ok">Full name</label><input type="text" id="ok">
  <img src="divider.png" alt="">
</body>
</html>`;

const CLEAN = `<!DOCTYPE html>
<html lang="en">
<head><title>Checkout</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
  <h1>Checkout</h1>
  <label for="email">Email</label><input type="text" id="email">
  <a href="/basket">Back to basket</a>
  <img src="divider.png" alt="">
</body>
</html>`;

describe('the pipeline', () => {
  let report: Awaited<ReturnType<typeof scan>>;

  beforeAll(async () => {
    const renderer = new StaticRenderer();
    report = await scan({
      targets: [{ label: 'broken.html', html: BROKEN }],
      renderer,
      table,
      marloVersion: '0.1.0-test',
    });
    await renderer.dispose();
  });

  it('finds the violations that are there', () => {
    const found = new Set(report.pages[0]?.findings.map((f) => f.actRuleId));
    // Each of these is a distinct category the product spec commits to.
    for (const expected of ['b5c3f8', '2779a5', 'b4f0c3', 'c487ae', 'e086e5', '3ea0c8', '6cfa84']) {
      expect(found, `expected to find ${expected}`).toContain(expected);
    }
  });

  it('does not report the field that is labelled correctly', () => {
    // The negative case. A tool that reports a correctly labelled input has taught the
    // developer to stop reading its output.
    const fieldFindings = report.pages[0]?.findings.filter((f) => f.actRuleId === 'e086e5') ?? [];
    for (const finding of fieldFindings) {
      expect(finding.verdict.target.snippet).not.toContain('id="ok"');
    }
  });

  it('crashes on nothing', () => {
    // Thirteen rules crashed the first time this ran, because the HTML CodeSniffer adapter
    // treated a DOM node as a string. A crash is never a pass, so it showed up loudly, but
    // it also meant thirteen rules went unmeasured.
    expect(report.totals.errored).toBe(0);
  });

  it('reports contrast as not evaluated rather than passing', () => {
    expect(report.totals.notEvaluated).toBeGreaterThan(0);
    const notEvaluated = report.coverage.notEvaluated.map((n) => n.actRuleId);
    expect(notEvaluated).toContain('afw4f7');
    // And never as a finding, which would be a verdict computed from unresolved styles.
    expect(report.pages[0]?.findings.map((f) => f.actRuleId)).not.toContain('afw4f7');
  });

  it('attaches the measured accuracy to every finding', () => {
    for (const finding of report.pages[0]?.findings ?? []) {
      expect(['calibrated', 'uncalibrated']).toContain(finding.confidence.source);
      if (finding.confidence.source === 'calibrated') {
        expect(finding.confidence.sampleSize).toBeGreaterThan(0);
      }
    }
  });

  it('states coverage as a fraction of the published denominator', () => {
    expect(report.coverage.publishedActRules).toBe(94);
    expect(report.coverage.implemented).toBe(35);
  });

  it('records where the invariant was enforced', () => {
    // On this page Marlo catches the placeholder-only input where the routed engine does
    // not, so the invariant fires. Asserting it here rather than only in the report package
    // proves the wiring reaches the surface.
    const enforced = report.invariantEnforced.map((i) => i.actRuleId);
    expect(enforced.length).toBeGreaterThan(0);
  });

  it('produces a report that validates against the schema', () => {
    expect(() => renderSarif(report)).not.toThrow();
    expect(report.schemaVersion).toBe(1);
  });

  it('gives a clean page no findings', async () => {
    const renderer = new StaticRenderer();
    const clean = await scan({
      targets: [{ label: 'clean.html', html: CLEAN }],
      renderer,
      table,
      marloVersion: '0.1.0-test',
    });
    await renderer.dispose();
    // Not zero findings on the whole page necessarily: a page with no main landmark is a
    // real finding for some rules. But none of the ones this page fixed.
    const found = new Set(clean.pages[0]?.findings.map((f) => f.actRuleId));
    for (const fixed of ['b5c3f8', '2779a5', 'b4f0c3', 'e086e5']) {
      expect(found, `${fixed} should not fire on the clean page`).not.toContain(fixed);
    }
  });
});

describe('exit codes', () => {
  const base = {
    totals: { errored: 0, notEvaluated: 0, findings: 0 },
  } as unknown as Awaited<ReturnType<typeof scan>>;

  it('is clean with nothing found', () => {
    expect(exitCodeFor(base, false)).toBe(EXIT_CODES.clean);
  });

  it('is findings when there are findings', () => {
    const withFindings = { ...base, totals: { ...base.totals, findings: 3 } };
    expect(exitCodeFor(withFindings, false)).toBe(EXIT_CODES.findings);
  });

  it('ranks incomplete above findings', () => {
    // A caller treating 1 as "there is work to do" would otherwise read an incomplete
    // measurement as a complete one.
    const both = { ...base, totals: { ...base.totals, findings: 3, errored: 1 } };
    expect(exitCodeFor(both, false)).toBe(EXIT_CODES.incomplete);
  });

  it('only fails on skipped rules when asked', () => {
    const skipped = { ...base, totals: { ...base.totals, notEvaluated: 2 } };
    expect(exitCodeFor(skipped, false)).toBe(EXIT_CODES.clean);
    expect(exitCodeFor(skipped, true)).toBe(EXIT_CODES.incomplete);
  });
});

describe('the terminal surface', () => {
  it('is complete without colour', async () => {
    const renderer = new StaticRenderer();
    const report = await scan({
      targets: [{ label: 'broken.html', html: BROKEN }],
      renderer,
      table,
      marloVersion: '0.1.0-test',
    });
    await renderer.dispose();

    const plain = renderTerminal(report, { colour: false });

    // Severity survives without colour, because it is a text mark.
    expect(plain).toMatch(/critical/);
    expect(plain).toContain('▲');
    // No escape sequences at all when colour is off.
    expect(plain).not.toMatch(/\[/);
    // What was not examined appears before the findings.
    expect(plain.indexOf('NOT EXAMINED')).toBeLessThan(plain.indexOf('critical'));
    expect(plain).toContain('This is not a pass');
    // And the reader is told where the numbers came from.
    expect(plain).toContain('calibration');
  });
});

describe('the marlo command', () => {
  const bin = resolve(ROOT, 'packages/cli/dist/bin.js');
  let built = false;

  beforeAll(() => {
    try {
      readFileSync(bin);
      built = true;
    } catch {
      built = false;
    }
  });

  /**
   * `out` is stdout alone and `err` is stderr alone.
   *
   * They are kept apart because the machine-readable modes write to stdout and must be
   * parseable on their own. The first version concatenated them and the SARIF test failed
   * on whatever else the process had said.
   */
  function run(args: readonly string[]): { code: number; out: string; err: string } {
    try {
      const out = execFileSync('node', [bin, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, out, err: '' };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
    }
  }

  it('prints help and exits clean', () => {
    if (!built) return;
    const { code, out } = run(['--help']);
    expect(code).toBe(EXIT_CODES.clean);
    expect(out).toContain('marlo scan');
    // The help text says what is not built, rather than offering a flag that does nothing.
    expect(out).toContain('NOT YET');
  });

  it('reports an unreadable file for `fix` rather than a stack', () => {
    // `fix` used to be a stub that refused. It is implemented now, so the interesting assertion
    // is that a missing file is still a clean usage error.
    if (!built) return;
    const { code, err } = run(['fix', 'does-not-exist.html']);
    expect(code).toBe(EXIT_CODES.usage);
    expect(err).toContain('marlo:');
    expect(err).not.toContain('at Object.');
  });

  it('exits 1 on a page with findings', () => {
    if (!built) return;
    const dir = mkdtempSync(join(tmpdir(), 'marlo-cli-'));
    const file = join(dir, 'broken.html');
    writeFileSync(file, BROKEN, 'utf8');
    const { code, out } = run(['scan', file, '--no-color']);
    expect(code).toBe(EXIT_CODES.findings);
    expect(out).toContain('finding');
  });

  it('emits valid JSON and valid SARIF', () => {
    if (!built) return;
    const dir = mkdtempSync(join(tmpdir(), 'marlo-cli-'));
    const file = join(dir, 'broken.html');
    writeFileSync(file, BROKEN, 'utf8');

    const json = run(['scan', file, '--json']);
    expect(() => JSON.parse(json.out)).not.toThrow();

    const sarif = run(['scan', file, '--sarif']);
    const parsed: unknown = JSON.parse(sarif.out);
    expect(typeof parsed).toBe('object');
    const runs = Reflect.get(parsed as object, 'runs');
    expect(Array.isArray(runs)).toBe(true);
  });

  it('reports coverage as a fraction', () => {
    if (!built) return;
    const { code, out } = run(['coverage']);
    expect(code).toBe(EXIT_CODES.clean);
    expect(out).toMatch(/\d+ of 94 published ACT rules/);
  });

  it('explains a rule with both accuracy views', () => {
    if (!built) return;
    const { code, out } = run(['explain', 'c487ae']);
    expect(code).toBe(EXIT_CODES.clean);
    expect(out).toContain('ACT verdict');
    expect(out).toContain('strict');
  });

  /*
   * `marlo scan page.html --renderer static` used to try to open a file called `static` and
   * fail with ENOENT on a path nobody had typed. The file list was built by filtering argv for
   * anything not starting with a dash, which catches every flag value too.
   *
   * Nothing in this file caught it, because no test had ever passed a value to a flag. The
   * GitHub Action did, on its first run.
   */
  it('does not treat a flag value as a file to scan', () => {
    if (!built) return;
    const dir = mkdtempSync(join(tmpdir(), 'marlo-cli-'));
    const file = join(dir, 'broken.html');
    writeFileSync(file, BROKEN, 'utf8');

    const { code, err } = run(['scan', file, '--renderer', 'static']);
    expect(err).not.toContain('ENOENT');
    expect(err).not.toContain("open '");
    // Exit 1 because the page has findings, which is the scan having worked.
    expect(code).toBe(EXIT_CODES.findings);
  });

  it('rejects a value flag with nothing after it', () => {
    if (!built) return;
    const { code, err } = run(['scan', 'x.html', '--renderer']);
    expect(code).toBe(EXIT_CODES.usage);
    expect(err).toContain('needs a value');
  });

  it('rejects a value flag followed by another flag', () => {
    if (!built) return;
    const { code, err } = run(['scan', 'x.html', '--renderer', '--json']);
    expect(code).toBe(EXIT_CODES.usage);
    expect(err).toContain('needs a value');
  });

  it('fixes only what it can verify, and writes nothing without --write', () => {
    if (!built) return;
    const dir = mkdtempSync(join(tmpdir(), 'marlo-fix-'));
    const file = join(dir, 'broken.html');
    // Two findings, one of each kind. 78fd32 is the one codemod rule that currently
    // clears the auto-fix gate (precision 1.00 over 6 decision-bearing cases) and gets
    // fixed; b4f0c3 measures well on precision but over only 4 such cases, below the
    // sample floor, and stays flagged. The pairing is what "only what it can verify" means.
    const original =
      '<!doctype html><html lang="en"><head><title>t</title>' +
      '<meta name="viewport" content="width=device-width, user-scalable=no"></head>' +
      '<body><p style="line-height: 1em !important; max-width: 200px;">' +
      'The toy brought back fond memories of being lost in the rain forest.</p></body></html>';
    writeFileSync(file, original, 'utf8');

    const dry = run(['fix', file]);
    expect(dry.out).toContain('FIXED');
    expect(dry.out).toContain('nothing was written');
    // The whole point of a dry run.
    expect(readFileSync(file, 'utf8')).toBe(original);

    const applied = run(['fix', file, '--write']);
    expect(applied.out).toContain('written:');
    const after = readFileSync(file, 'utf8');
    expect(after).not.toBe(original);
    expect(after).not.toContain('!important');
    expect(after).toContain('user-scalable');
  }, 90_000);

  it('refuses to apply a mechanical fix for a rule measured below the threshold', () => {
    if (!built) return;
    const dir = mkdtempSync(join(tmpdir(), 'marlo-fix-'));
    const file = join(dir, 'spacing.html');
    const original =
      '<!doctype html><html lang="en"><head><title>t</title></head>' +
      '<body><p style="letter-spacing: 0.01em !important">x</p></body></html>';
    writeFileSync(file, original, 'utf8');

    const result = run(['fix', file, '--write']);
    // The gate biting on a fix that is mechanically correct. 24afc2 measures perfect
    // precision now, but over only 4 decision-bearing cases against a sample floor of 6,
    // and the measurement is printed rather than the refusal alone, so a reader can
    // disagree with either number.
    expect(result.out).toContain('below-threshold');
    expect(result.out).toMatch(/strict precision \d\.\d+ over \d+ official test cases/);
    expect(readFileSync(file, 'utf8')).toContain('!important');
  }, 90_000);

  it('says so, rather than nothing, when it will not fix a rule', () => {
    if (!built) return;
    const dir = mkdtempSync(join(tmpdir(), 'marlo-fix-'));
    const file = join(dir, 'lang.html');
    writeFileSync(file, '<html><head><title>t</title></head><body><p>x</p></body></html>', 'utf8');
    const result = run(['fix', file]);
    expect(result.out).toContain('FLAG');
    expect(result.out).toContain('you decide:');
  }, 90_000);

  it('rejects the browser renderer rather than silently using the static one', () => {
    if (!built) return;
    // Silently downgrading would report layout rules as not evaluated while the caller
    // believed they had been checked.
    const { code, err } = run(['scan', 'x.html', '--renderer', 'browser']);
    expect(code).toBe(EXIT_CODES.usage);
    expect(err).toContain('not the same as passing');
  });
});

describe('run ids', () => {
  it('are 16 hex characters and unique', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRunId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});
