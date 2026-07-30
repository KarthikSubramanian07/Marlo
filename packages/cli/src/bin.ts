#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ActRuleId, EngineReport, Repair } from '@marlo/schema';
import { CalibrationTable, EXIT_CODES } from '@marlo/schema';
import { StaticRenderer } from '@marlo/render';
import { peerEngines } from '@marlo/engines';
import { MarloEngine } from '@marlo/calibrate';
import { renderSarif, renderTerminal, shouldUseColour } from '@marlo/report';
import { repairFinding, repairedText } from '@marlo/repair';
import { exitCodeFor, scan } from './pipeline.js';

/**
 * The `marlo` command.
 *
 * Two things it does that most scanners do not, and both are the point of the product.
 *
 * It prints what it could not examine as prominently as what it found, above the findings
 * rather than in a footnote. A run that skipped the contrast rules says so.
 *
 * It prints where every accuracy number came from. `marlo scan` ends with the calibration
 * date and the corpus date, so a reader can go and check the figure rather than trust it.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

/**
 * Sets the exit code and returns, rather than calling process.exit.
 *
 * THIS IS NOT STYLE. process.exit terminates immediately, and when stdout is a pipe rather
 * than a terminal, console.log is asynchronous: the write is queued and the process dies
 * before it drains. `marlo scan --json | tee report.json` truncated at exactly 65526 bytes,
 * silently, producing a file that looked like a report and was unparseable.
 *
 * Setting process.exitCode lets Node exit naturally once stdout has flushed. The exit code
 * is identical; the output is not.
 */
function finish(code: number): void {
  process.exitCode = code;
}

function version(): string {
  const pkg: unknown = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
  );
  if (typeof pkg === 'object' && pkg !== null && 'version' in pkg) {
    const v: unknown = Reflect.get(pkg, 'version');
    if (typeof v === 'string') return v;
  }
  return '0.0.0';
}

const HELP = `marlo ${version()}

  Fixes accessibility violations and proves it. Or, right now, finds them and shows
  you exactly how much to trust each one.

USAGE
  marlo scan <file...> [options]
  marlo fix <file...> [--write]
  marlo explain <act-rule-id>
  marlo coverage

OPTIONS
  --json              Machine-readable report on stdout, nothing else.
  --sarif             SARIF 2.1.0 on stdout, with per-engine provenance on every result.
  --renderer <which>  static (default) or browser. The browser renderer adds layout and
                      paint, which the contrast and focus rules need. It costs a Chromium.
  --rule <act-id>     Evaluate one rule. Repeatable.
  --fail-on-skipped   Exit 3 when a rule could not be evaluated. Off by default, because
                      most callers want to know about findings first.
  --write             fix only. Apply the verified fixes to the files. Without it, fix
                      prints what it would do and changes nothing.
  --no-color          Also honours NO_COLOR. Severity is never colour alone, so removing
                      colour loses nothing.
  -h, --help          This.
  -v, --version       Version.

EXIT CODES
  0  nothing found in the rules that were evaluated
  1  findings
  2  Marlo could not run: bad arguments, unreadable file
  3  incomplete: a rule crashed, or was skipped and you asked to fail on that

FIX
  marlo fix applies only changes it has verified: the target rule closed, nothing else
  broke, and applying the edits twice is the same as applying them once. Anything it
  cannot verify comes back as a flag with the generated change attached and not applied.

  A rule is only eligible if the engine reporting it clears the published accuracy
  threshold. Seven rules have a mechanical fix; on the current table two of them clear it.
  marlo explain <rule> says which, and why.

NOT YET
  Repair does not open pull requests. That surface is opt-in, off by default, and lands
  with the GitHub Action rather than here.

  Coverage, accuracy per rule, and which engine reports what: calibration/README.md.
`;

/**
 * Reports a usage error and stops.
 *
 * Writes to stderr and sets the exit code rather than calling process.exit, for the same
 * reason `finish` exists: an immediate exit can drop a queued write.
 */
function fail(message: string): never {
  console.error(`marlo: ${message}\n\nTry \`marlo --help\`.`);
  process.exitCode = EXIT_CODES.usage;
  throw new UsageError(message);
}

/** Thrown by `fail` so main can unwind without process.exit. */
class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.log(HELP);
  finish(EXIT_CODES.clean);
} else if (argv.includes('-v') || argv.includes('--version')) {
  console.log(version());
  finish(EXIT_CODES.clean);
} else {
  try {
    await main();
  } catch (error) {
    // A usage error has already reported itself and set the exit code. Anything else is a
    // bug, and a bug should print its message rather than a stack nobody reads.
    if (!(error instanceof UsageError)) {
      console.error(`marlo: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = EXIT_CODES.usage;
    }
  }
}

function loadTable(): CalibrationTable {
  try {
    return CalibrationTable.parse(
      JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
    );
  } catch (error) {
    // Refusing to run is right. Every confidence figure Marlo prints comes from this
    // file, and a scan with no calibration data would be a scan with no accuracy claim
    // while looking exactly like one that had.
    fail(
      'could not read calibration/table.json, so there is no accuracy data to report ' +
        `against.\n  Run \`pnpm calibrate\` to generate it.\n  ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
}

async function main(): Promise<void> {
  const verb = argv[0] ?? '';
  const flags = new Set(argv.filter((a) => a.startsWith('--')));

  /*
   * Flags that consume the next argument. Their values are not files, and the first version of
   * this treated them as files: `marlo scan page.html --renderer static` tried to open a file
   * named `static` and failed with ENOENT on a path nobody had typed.
   *
   * Found by writing the GitHub Action, which passes `--renderer` on every invocation. Nothing
   * in the CLI's own tests passed a value to a flag.
   */
  const VALUE_FLAGS = new Set(['--renderer', '--rule']);

  const files: string[] = [];
  const rules: string[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) fail(`${arg} needs a value`);
      if (arg === '--rule') rules.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
    files.push(arg);
  }

  switch (verb) {
    case 'coverage': {
      const table = loadTable();
      console.log(
        `${String(table.coverage.implemented)} of ${String(table.coverage.publishedActRules)} published ACT rules`,
      );
      console.log(
        `${String(table.coverage.calibratable)} of those have measured accuracy against the ` +
          'official ACT test cases.',
      );
      if (table.coverage.implementedButUnmeasurable.length > 0) {
        console.log(
          `${String(table.coverage.implementedButUnmeasurable.length)} implemented rule(s) have ` +
            'no official test cases, so their accuracy is unmeasured: ' +
            table.coverage.implementedButUnmeasurable.join(' '),
        );
      }
      if (table.aggregate.falsePositiveRate !== null) {
        console.log(
          `False positive rate: ${(table.aggregate.falsePositiveRate * 100).toFixed(1)}% over ` +
            `${String(table.aggregate.sampleSize)} test cases.`,
        );
      }
      console.log(`Calibration generated ${table.generated}. Details: calibration/README.md`);
      finish(EXIT_CODES.clean);
      return;
    }

    case 'explain': {
      const actRuleId = files[0] ?? rules[0];
      if (actRuleId === undefined) fail('explain needs an ACT rule id, for example b5c3f8');
      const table = loadTable();
      const entries = table.entries.filter(
        (e) => e.actRuleId === actRuleId && e.mappingKind !== 'none',
      );
      if (entries.length === 0) {
        fail(`no engine in the calibration table implements ${actRuleId}`);
      }
      const routed = table.routing.find((r) => r.actRuleId === actRuleId);
      console.log(`${actRuleId}  https://act-rules.github.io/rules/${actRuleId}`);
      console.log('');
      console.log(`Reported by: ${routed?.chosen ?? 'nobody'} (${routed?.reason ?? 'unknown'})`);
      console.log(`Auto-fix permitted: ${(routed?.autoFixPermitted ?? false) ? 'yes' : 'no'}\n`);
      console.log('engine      ACT verdict  strict P  strict R  cantTell(fail/pass)  mapping');
      for (const e of entries) {
        console.log(
          `${e.engine.padEnd(11)} ${e.act.consistency.padEnd(12)} ` +
            `${(e.strict.precision?.toFixed(2) ?? '  n/a').padEnd(9)} ` +
            `${(e.strict.recall?.toFixed(2) ?? '  n/a').padEnd(9)} ` +
            `${`${String(e.strict.cantTellOnFailed)}/${String(e.strict.cantTellOnPassed)}`.padEnd(20)} ` +
            e.mappingKind,
        );
      }
      const flattered = entries.filter((e) => e.flatteredByProtocol);
      if (flattered.length > 0) {
        console.log(
          `\nNote: ${flattered.map((e) => e.engine).join(', ')} would be reported as a correct ` +
            "implementation of this rule by W3C's protocol while missing more than half the " +
            'violations. That gap is why the table has two halves.',
        );
      }
      finish(EXIT_CODES.clean);
      return;
    }

    case 'scan': {
      if (files.length === 0) fail('scan needs at least one file');
      const table = loadTable();

      if (flags.has('--renderer') || argv.includes('--renderer')) {
        const which = argv[argv.indexOf('--renderer') + 1];
        if (which === 'browser') {
          fail(
            'the browser renderer needs Playwright and is wired up in the CLI in a later ' +
              'branch. The static renderer reports layout-dependent rules as not evaluated, ' +
              'which is not the same as passing them.',
          );
        }
        if (which !== 'static') fail(`unknown renderer "${which ?? ''}". Use static.`);
      }

      const renderer = new StaticRenderer();
      const report = await scan({
        targets: files.map((f) => ({ label: f, path: resolve(process.cwd(), f) })),
        renderer,
        table,
        marloVersion: version(),
        ...(rules.length === 0 ? {} : { rules }),
      });
      await renderer.dispose();

      if (flags.has('--json')) {
        console.log(JSON.stringify(report, null, 2));
      } else if (flags.has('--sarif')) {
        console.log(renderSarif(report));
      } else {
        const colour = flags.has('--no-color')
          ? false
          : shouldUseColour(process.env, process.stdout.isTTY);
        console.log(renderTerminal(report, { colour }));
      }

      finish(exitCodeFor(report, flags.has('--fail-on-skipped')));
      return;
    }

    case 'fix': {
      if (files.length === 0) fail('fix needs at least one file');
      const table = loadTable();
      const renderer = new StaticRenderer();
      const write = flags.has('--write');
      let fixed = 0;
      let flagged = 0;

      try {
        for (const file of files) {
          const path = resolve(process.cwd(), file);
          const html = readFileSync(path, 'utf8');
          const report = await scan({
            targets: [{ label: file, path }],
            renderer,
            table,
            marloVersion: version(),
            ...(rules.length === 0 ? {} : { rules }),
          });

          const evaluate = async (
            source: string,
            only: readonly ActRuleId[],
          ): Promise<readonly EngineReport[]> => {
            const page = await renderer.render({ html: source });
            try {
              const engines = [new MarloEngine(), ...peerEngines()];
              return await Promise.all(engines.map(async (e) => await e.evaluate(page, only)));
            } finally {
              await page.close();
            }
          };

          const repairs: Repair[] = [];
          for (const finding of report.pages.flatMap((p) => p.findings)) {
            repairs.push(await repairFinding(finding, { html, file, renderer, table, evaluate }));
          }

          const fixes = repairs.filter(
            (r): r is Extract<Repair, { kind: 'fixed' }> => r.kind === 'fixed',
          );
          const flagged2 = repairs.filter(
            (r): r is Extract<Repair, { kind: 'flagged' }> => r.kind === 'flagged',
          );
          fixed += fixes.length;
          flagged += flagged2.length;

          console.log(`\n${file}`);
          console.log(
            `  ${String(fixes.length)} verified, ${String(flagged2.length)} flagged for a human`,
          );
          for (const repair of fixes) {
            console.log(`\n  FIXED  ${repair.actRuleId}  ${repair.finding.actRuleName}`);
            console.log(`      ${repair.summary}`);
            for (const edit of repair.edits) {
              console.log(`      - ${edit.before.trim()}`);
              console.log(`      + ${edit.after.trim()}`);
            }
            console.log(
              '      verified: target closed, nothing else broke, applying twice is the same ' +
                'as once',
            );
          }
          for (const repair of flagged2) {
            console.log(`\n  FLAG   ${repair.finding.actRuleId}  ${repair.finding.actRuleName}`);
            console.log(`      not fixed: ${repair.reason}`);
            console.log(`      ${repair.explanation}`);
            console.log(`      you decide: ${repair.humanDecision}`);
          }

          const repaired = repairedText(html, repairs);
          if (repaired === null) continue;
          if (write) {
            writeFileSync(path, repaired, 'utf8');
            console.log(`\n  written: ${file}`);
          } else {
            console.log('\n  nothing was written. Pass --write to apply the verified fixes.');
          }
        }
      } finally {
        await renderer.dispose();
      }

      console.log(
        `\n${String(fixed)} verified fix(es), ${String(flagged)} flagged. ` +
          'Only changes Marlo verified are ever applied.',
      );
      finish(fixed > 0 || flagged > 0 ? EXIT_CODES.findings : EXIT_CODES.clean);
      return;
    }

    default:
      fail(`unknown command "${verb}"`);
  }
}
