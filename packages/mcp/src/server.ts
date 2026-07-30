import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeCoverage, findRule } from '@marlo/act';
import type { ActRuleId, CalibrationTable, ScanReport } from '@marlo/schema';
import { CalibrationTable as CalibrationTableSchema, formatCoverage } from '@marlo/schema';
import { IMPLEMENTED_RULES } from '@marlo/rules';
import { StaticRenderer } from '@marlo/render';
import { scan } from '@marlo/cli';

/**
 * Marlo over the Model Context Protocol.
 *
 * WHY EVERY TOOL HERE IS READ-ONLY
 *
 * An MCP server is a set of capabilities handed to a model that will call them without a
 * human between the decision and the effect. That is the whole point of it, and it is also
 * why this one cannot write anything.
 *
 * Marlo's standing promise is that it never merges, never pushes to a default branch, never
 * force pushes, never rewrites history and never deploys. A promise like that is worth
 * exactly as much as the narrowest surface that could break it, so the narrowest surface
 * does not have the capability at all. There is no `fix` tool, no `apply` tool, and no tool
 * that takes a path and writes to it. When the repair layer lands, the thing that offers to
 * change your code is a pull request a person approves, not a tool call.
 *
 * The tools are also deliberately dull. Two existing MCP servers in this space were studied
 * (`priyankark/a11y-mcp` and `ronantakizawa/a11ymcp`, both in docs/licenses.md) and the one
 * idea taken from them is worth naming: accepting HTML source directly rather than only a
 * URL. A model holding a component it just wrote should be able to ask about that, without
 * serving it first.
 *
 * WHAT MAKES THIS DIFFERENT FROM WRAPPING axe-core
 *
 * Every result carries the measured accuracy of the engine that produced it, and every
 * response says what was not examined before it says what was found. A model that gets
 * "no violations" from a renderer with no layout will report a clean page to its user. A
 * model that gets "two rules need layout and were not evaluated" can say so, or ask for the
 * browser renderer. The difference is entirely in what the tool returns.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

/** The wire shape of a tool, kept minimal so no transport detail leaks into the logic. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  };
}

export interface ToolResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly isError?: boolean;
}

export function loadTable(root: string = ROOT): CalibrationTable {
  return CalibrationTableSchema.parse(
    JSON.parse(readFileSync(resolve(root, 'calibration/table.json'), 'utf8')),
  );
}

/**
 * The tools, in the order a model is most likely to need them.
 *
 * Every description states a limit. A description that only says what a tool does invites a
 * model to over-trust it, and the whole argument of this project is that over-trust in an
 * accessibility checker is the default failure.
 */
export const TOOLS: readonly ToolDefinition[] = Object.freeze([
  {
    name: 'marlo_scan_html',
    description:
      'Check HTML source against the ACT rules Marlo implements. Returns findings with the ' +
      'measured accuracy of the engine that reported each one, and states which rules could ' +
      'not be evaluated before listing what was found. Not comprehensive: coverage is a ' +
      'fraction of the published ACT rules and automation reaches a minority of WCAG. Runs ' +
      'in a Node DOM with no CSS layout, so contrast and focus visibility come back as not ' +
      'evaluated rather than as passing.',
    inputSchema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'The HTML source to check.' },
        label: {
          type: 'string',
          description: 'A name for this source in the output, such as a component name.',
        },
        rules: {
          type: 'array',
          items: { type: 'string' },
          description: 'ACT rule identifiers to limit the scan to. Omit to run all of them.',
        },
      },
      required: ['html'],
    },
  },
  {
    name: 'marlo_explain_rule',
    description:
      'Explain one ACT rule: what it requires, which WCAG success criteria it maps to, and ' +
      'how accurately each engine implements it, in both the official W3C view and a strict ' +
      'view where "cannot tell" counts as no detection. Use this before trusting a finding.',
    inputSchema: {
      type: 'object',
      properties: {
        actRuleId: { type: 'string', description: 'An ACT rule identifier, for example c487ae.' },
      },
      required: ['actRuleId'],
    },
  },
  {
    name: 'marlo_coverage',
    description:
      'What Marlo covers, as a fraction with its denominator, plus its measured false ' +
      'positive rate. Call this before reporting any result to a person, so the report can ' +
      'say what was not checked.',
    inputSchema: { type: 'object', properties: {} },
  },
]);

/**
 * The write tools this server does not have, and the reason, returned verbatim when a model
 * asks for one anyway.
 *
 * Naming them is better than a bare "unknown tool". A model that asked for `marlo_fix` had a
 * reasonable expectation, and the useful answer explains the boundary instead of looking
 * like a typo.
 */
const REFUSED: Readonly<Record<string, string>> = Object.freeze({
  marlo_fix:
    'Marlo has no fix tool over MCP, and will not have one. Repair arrives as a pull ' +
    'request a person approves, because a tool call has no human between the decision and ' +
    'the edit. The repair layer is also not merged yet.',
  marlo_apply:
    'Marlo does not write files. See marlo_fix: repair arrives as a pull request a person ' +
    'approves.',
  marlo_commit: 'Marlo never commits, merges, pushes, force pushes or deploys. Not a capability.',
  marlo_merge: 'Marlo never merges. Not a capability, over any transport.',
  marlo_deploy: 'Marlo never deploys. Not a capability, over any transport.',
});

/** Every tool name this server refuses on principle rather than for lack of implementation. */
export function refusedTools(): readonly string[] {
  return Object.keys(REFUSED);
}

function text(body: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text: body }], isError };
}

/** Renders a scan the way a model should relay it: limits first, findings second. */
export function renderForModel(report: ScanReport): string {
  const lines: string[] = [];
  const findings = report.pages.flatMap((p) => p.findings);
  const notEvaluated = report.coverage.notEvaluated;
  const errored = report.pages
    .flatMap((p) => p.results)
    .filter((r) => r.status === 'error')
    .map((r) => `${r.actRuleId} (${r.engine})`);

  lines.push(`Coverage: ${formatCoverage(report.coverage)}.`);

  if (notEvaluated.length > 0) {
    lines.push('');
    lines.push(
      `NOT EVALUATED: ${String(notEvaluated.length)} rule(s). The ${report.pages[0]?.renderer ?? 'static'} ` +
        `renderer does not provide a capability they need. This is not a pass, and a report ` +
        `to a person must say so.`,
    );
    for (const rule of notEvaluated) {
      lines.push(`  ${rule.actRuleId}  needs ${rule.missing.join(', ')}`);
    }
  }

  if (errored.length > 0) {
    lines.push('');
    lines.push(`ERRORED: ${errored.join(', ')}. An engine threw, so those rules are unmeasured.`);
  }

  lines.push('');
  if (findings.length === 0) {
    lines.push(
      'No violations found among the rules that were evaluated. That is not the same as an ' +
        'accessible page: see the coverage fraction above and the rules not evaluated.',
    );
  } else {
    lines.push(`${String(findings.length)} finding(s).`);
  }

  for (const finding of findings) {
    lines.push('');
    lines.push(`${finding.severity}  ${finding.actRuleId}  ${finding.actRuleName}`);
    lines.push(
      `  WCAG ${finding.successCriteria.join(', ') || 'no mapped criterion'}  ` +
        `reported by ${finding.reportedBy}`,
    );
    lines.push(
      finding.confidence.source === 'calibrated'
        ? `  accuracy: precision ${finding.confidence.precision?.toFixed(2) ?? 'not measured'} ` +
            `over ${String(finding.confidence.sampleSize)} official test cases`
        : '  accuracy: not calibrated for this rule, so treat the finding as unweighted',
    );
    lines.push(`  where: ${finding.verdict.target.selector}`);
    if (finding.source === null && finding.locationNote !== null) {
      lines.push(`  ${finding.locationNote}`);
    }
    for (const disagreement of finding.disagreements) {
      lines.push(`  disagreement: ${disagreement.engine} says ${disagreement.outcome}`);
    }
    lines.push(`  ${finding.help}`);
  }

  lines.push('');
  lines.push(
    `Calibration generated ${report.calibration.generated}, corpus retrieved ` +
      `${report.calibration.corpusRetrieved}. Marlo provides automated analysis, not legal ` +
      `certification.`,
  );
  return lines.join('\n');
}

export interface CallOptions {
  readonly table: CalibrationTable;
  readonly marloVersion: string;
}

/**
 * Dispatches one tool call. Pure apart from the renderer, so the transport can be tested
 * separately from the behaviour, and so a refusal can be asserted without a socket.
 */
export async function callTool(
  name: string,
  args: Readonly<Record<string, unknown>>,
  options: CallOptions,
): Promise<ToolResult> {
  const refusal = REFUSED[name];
  if (refusal !== undefined) return text(refusal, true);

  switch (name) {
    case 'marlo_scan_html': {
      const html = args['html'];
      if (typeof html !== 'string' || html.trim() === '') {
        return text('marlo_scan_html needs an `html` string.', true);
      }
      const requested = Array.isArray(args['rules'])
        ? args['rules'].filter((r): r is string => typeof r === 'string')
        : undefined;
      const known = new Set<string>(IMPLEMENTED_RULES);
      const unknown = (requested ?? []).filter((r) => !known.has(r));
      if (unknown.length > 0) {
        return text(
          `Marlo does not implement: ${unknown.join(', ')}. Call marlo_coverage for the list.`,
          true,
        );
      }
      const label = typeof args['label'] === 'string' ? args['label'] : 'source';
      const report = await scan({
        targets: [{ label, html }],
        renderer: new StaticRenderer(),
        table: options.table,
        marloVersion: options.marloVersion,
        ...(requested !== undefined && requested.length > 0
          ? { rules: requested.filter((r): r is ActRuleId => known.has(r)) }
          : {}),
      });
      return text(renderForModel(report));
    }

    case 'marlo_explain_rule': {
      const actRuleId = args['actRuleId'];
      if (typeof actRuleId !== 'string') {
        return text('marlo_explain_rule needs an `actRuleId` string.', true);
      }
      const published = findRule(actRuleId);
      if (published === undefined) {
        return text(`${actRuleId} is not a published ACT rule identifier.`, true);
      }
      const entries = options.table.entries.filter((e) => e.actRuleId === actRuleId);
      const routed = options.table.routing.find((r) => r.actRuleId === actRuleId);

      const lines: string[] = [];
      lines.push(`${actRuleId}  ${published.name}`);
      lines.push(`WCAG ${published.successCriteria.join(', ') || 'no mapped criterion'}`);
      const implemented = new Set<string>(IMPLEMENTED_RULES).has(actRuleId);
      lines.push(`Implemented by Marlo: ${implemented ? 'yes' : 'no'}`);
      lines.push(
        `Reported by: ${routed?.chosen ?? 'nobody, so Marlo does not report this rule at all'}`,
      );
      lines.push('');
      if (entries.length === 0) {
        lines.push('No engine has a measurement for this rule, so there is no accuracy to quote.');
      } else {
        lines.push('Per engine, both views:');
        for (const entry of entries) {
          // The entry already carries both views. Recomputing from the matrix here would be a
          // second implementation of the arithmetic every published number rests on.
          lines.push(
            `  ${entry.engine}: W3C verdict ${entry.act.consistency}, strict precision ` +
              `${entry.strict.precision?.toFixed(3) ?? 'not measured'}, strict recall ` +
              `${entry.strict.recall?.toFixed(3) ?? 'not measured'}, over ` +
              `${String(entry.testCaseCount)} official test cases` +
              (entry.flatteredByProtocol
                ? '. FLATTERED: officially consistent while missing more than half the violations.'
                : ''),
          );
        }
      }
      lines.push('');
      lines.push(
        `Auto-fix permitted: ${routed?.autoFixPermitted === true ? 'yes' : 'no'}. The threshold is ` +
          `${options.table.autoFixThreshold.minStrictPrecision.toFixed(2)} strict precision over at ` +
          `least ${String(options.table.autoFixThreshold.minSampleSize)} test cases.`,
      );
      return text(lines.join('\n'));
    }

    case 'marlo_coverage': {
      const coverage = computeCoverage({
        implemented: [...IMPLEMENTED_RULES],
        calibrated: [...IMPLEMENTED_RULES].filter((id) =>
          options.table.entries.some(
            (e) => e.actRuleId === id && e.engine === 'marlo' && e.testCaseCount > 0,
          ),
        ),
        notEvaluated: [],
      });
      const rate = options.table.aggregate.falsePositiveRate;
      return text(
        [
          `Marlo covers ${formatCoverage(coverage)}.`,
          `Measured false positive rate: ${rate === null ? 'not measured' : `${(rate * 100).toFixed(1)}%`} ` +
            `over ${String(options.table.aggregate.sampleSize)} official test case outcomes.`,
          '',
          'Automation reaches a minority of WCAG regardless of coverage. A clean result from ',
          'this server is evidence about the rules that were evaluated and nothing more.',
          '',
          `Rules: ${IMPLEMENTED_RULES.join(' ')}`,
        ].join('\n'),
      );
    }

    default:
      return text(
        `Unknown tool: ${name}. This server offers ${TOOLS.map((t) => t.name).join(', ')}, ` +
          'and refuses every tool that would write anything.',
        true,
      );
  }
}
