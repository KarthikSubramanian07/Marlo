import { createHash } from 'node:crypto';
import type {
  CalibrationTable,
  Coverage,
  Edit,
  FixReport,
  FixedFile,
  Flag,
  PullRequestBody,
  SuccessCriterion,
  VerifiedFix,
} from '@trymarlo/schema';
import { PullRequestBody as PullRequestBodySchema } from '@trymarlo/schema';
import { renderPullRequestBody } from '@trymarlo/report';
import { applyEdits, conflicts } from './apply.js';

/**
 * The pull request planner. Pure: no filesystem, no network, no git.
 *
 * It takes what `marlo fix --json` produced and decides what a pull request would contain,
 * and the whole point of it being a pure function is that the decision can be tested
 * without a repository: the same input has to produce byte-identical output, because the
 * branch name is derived from the content and the opener uses that name to find out
 * whether this work has already been done.
 *
 * IDEMPOTENCE IS A PROPERTY OF THE NAME
 *
 * `marlo/fix-<12 hex>` is a sha256 over the sorted list of every edit the plan applies,
 * as `(file, start, end, before, after)`. Two runs over the same repository state compute
 * the same edits, so they compute the same name, and the opener sees the branch or the
 * open pull request and stops. There is no timestamp and no run id anywhere in the plan.
 *
 * EVERYTHING IS CAPPED
 *
 * A bot that opens a four thousand file pull request is the reason the caps exist, and
 * each one is a named constant with its reason next to it. When the body is too long the
 * flags section is cut first and the body says how many were cut. The fixes section is
 * never cut: a change in the diff whose evidence is missing from the body is the artifact
 * this project argues against, so when even the fixes alone are too long, fixes are dropped
 * from the plan, diff and evidence together.
 *
 * TWO EDITS ON THE SAME BYTES EXCLUDE THE FILE
 *
 * `conflicts()` finds two verified fixes that touch the same range in one file. Each was
 * verified on its own against the original source, and neither was verified against the
 * other's output, so applying both is applying something nobody checked. The file is left
 * out of the plan and every fix in it comes back as a flag saying why. Never last-writer-wins.
 */

/** Files `marlo fix` is allowed to be pointed at in one run. Past this the run is a sweep, not a check. */
export const MAX_FILES_SCANNED = 200;

/** Verified fixes in one pull request. Past this nobody reads the evidence, and the evidence is the product. */
export const MAX_FIXES_PER_PULL_REQUEST = 50;

/** Characters in the body. GitHub stops accepting at 65 536, and the renderer needs room for the footer. */
export const MAX_BODY_CHARACTERS = 60_000;

/** Flags the body will ever try to render before trimming for length. Bounds the trimming loop. */
export const MAX_FLAGS_IN_BODY = 200;

/** Where the calibration table every number in the body came from can be read. */
export const CALIBRATION_TABLE_URL =
  'https://github.com/KarthikSubramanian07/Marlo/blob/main/calibration/table.json';

export interface PullRequestCaps {
  readonly files: number;
  readonly fixes: number;
  readonly bodyCharacters: number;
  readonly flagsInBody: number;
}

export const DEFAULT_CAPS: PullRequestCaps = Object.freeze({
  files: MAX_FILES_SCANNED,
  fixes: MAX_FIXES_PER_PULL_REQUEST,
  bodyCharacters: MAX_BODY_CHARACTERS,
  flagsInBody: MAX_FLAGS_IN_BODY,
});

export interface PlanInput {
  readonly reports: readonly FixReport[];
  readonly table: CalibrationTable;
  readonly marloVersion: string;
  readonly caps?: Partial<PullRequestCaps>;
  readonly calibrationUrl?: string;
}

export interface PlannedFile {
  readonly path: string;
  readonly contents: string;
}

export interface PlanSummary {
  /** Verified fixes the plan applies. */
  readonly fixesApplied: number;
  /** Findings handed back to a human: every flag, plus any fix excluded by a conflict or a cap. */
  readonly fixesRefused: number;
  readonly filesChanged: number;
  /** Files left out of the plan, each with the reason. */
  readonly filesExcluded: readonly { readonly path: string; readonly reason: string }[];
  /** Verified fixes that did not fit under the fix cap or the body cap. Not applied. */
  readonly fixesDeferred: number;
  /** Flags left out of the body to fit under the size cap. */
  readonly flagsOmitted: number;
}

export type PullRequestPlan =
  | {
      readonly kind: 'nothing-to-open';
      readonly reason: string;
      readonly summary: PlanSummary;
    }
  | {
      readonly kind: 'plan';
      readonly branch: string;
      readonly title: string;
      readonly body: string;
      readonly commitMessage: string;
      readonly files: readonly PlannedFile[];
      readonly summary: PlanSummary;
    };

/**
 * Why a target path may not be written by a pull request, or null when it may.
 *
 * The planner's paths become tree entries in a commit, so they have to be the
 * repository-relative paths the caller meant and nothing else. Anything under `.github/` is
 * refused outright: a tool that can edit CI can disable the check that constrains it
 * (SECURITY.md, D-011).
 */
export function refusedPath(target: string): string | null {
  if (target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target)) {
    return 'an absolute path; pass the path relative to the repository root';
  }
  const segments = target.split(/[\\/]/);
  if (segments.some((s) => s === '..' || s === '.' || s === '')) {
    return 'not a plain repository-relative path (it has an empty, `.` or `..` segment)';
  }
  if (segments[0] === '.github') {
    return 'under .github/, which Marlo never edits, because a tool that can edit CI can disable the check on it';
  }
  return null;
}

/* ── Helpers ──────────────────────────────────────────────────────────────────── */

function isFix(repair: FixedFile['repairs'][number]): repair is VerifiedFix {
  return repair.kind === 'fixed';
}

function isFlag(repair: FixedFile['repairs'][number]): repair is Flag {
  return repair.kind === 'flagged';
}

/** A stable order for fixes within a file: by where they land, then by rule. */
function byPosition(a: VerifiedFix, b: VerifiedFix): number {
  const aStart = Math.min(...a.edits.map((e) => e.start));
  const bStart = Math.min(...b.edits.map((e) => e.start));
  return aStart - bStart || a.actRuleId.localeCompare(b.actRuleId);
}

/** The branch name, from the content and nothing else. */
export function branchNameFor(edits: readonly Edit[]): string {
  const keys = edits.map((e) => JSON.stringify([e.file, e.start, e.end, e.before, e.after])).sort();
  const digest = createHash('sha256').update(keys.join('\n')).digest('hex');
  return `marlo/fix-${digest.slice(0, 12)}`;
}

/** A fix that was verified and is nonetheless handed back, with the reason attached. */
function flagFromFix(fix: VerifiedFix, reason: Flag['reason'], explanation: string): Flag {
  return {
    kind: 'flagged',
    finding: fix.finding,
    reason,
    explanation,
    humanDecision:
      'Apply one of the changes by hand, run Marlo again on the result, and let it verify ' +
      'the next one against what you kept.',
    corroboratedBy:
      fix.finding.agreedBy.length > 0 ? [...fix.finding.agreedBy] : [fix.finding.reportedBy],
    disagreements: [...fix.finding.disagreements],
    thresholdEvidence: fix.thresholdEvidence,
    unverifiedEdits: [...fix.edits],
    failedVerification: null,
  };
}

function describeConflict(pair: readonly [Edit, Edit]): string {
  const [a, b] = pair;
  return (
    `\`${a.actRuleId}\` at ${String(a.start)}..${String(a.end)} and \`${b.actRuleId}\` at ` +
    `${String(b.start)}..${String(b.end)}`
  );
}

interface FileWork {
  readonly path: string;
  readonly source: string;
  readonly fixes: readonly VerifiedFix[];
  readonly flags: readonly Flag[];
}

/** Coverage across several reports: the fraction is the same table, the gaps are unioned. */
function mergeCoverage(reports: readonly FixReport[]): Coverage {
  const first = reports[0];
  if (first === undefined) {
    return {
      implemented: 0,
      publishedActRules: 1,
      calibrated: 0,
      unmeasurable: [],
      notEvaluated: [],
    };
  }
  const notEvaluated = new Map<string, Set<string>>();
  for (const report of reports) {
    for (const gap of report.coverage.notEvaluated) {
      const missing = notEvaluated.get(gap.actRuleId) ?? new Set<string>();
      for (const capability of gap.missing) missing.add(capability);
      notEvaluated.set(gap.actRuleId, missing);
    }
  }
  return {
    ...first.coverage,
    notEvaluated: [...notEvaluated.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([actRuleId, missing]) => ({
        actRuleId,
        missing: [...missing].sort() as Coverage['notEvaluated'][number]['missing'],
      })),
  };
}

function pluralise(count: number, noun: string, plural = `${noun}s`): string {
  return `${String(count)} ${count === 1 ? noun : plural}`;
}

/* ── The planner ──────────────────────────────────────────────────────────────── */

export function planPullRequest(input: PlanInput): PullRequestPlan {
  const caps: PullRequestCaps = { ...DEFAULT_CAPS, ...input.caps };
  const calibrationUrl = input.calibrationUrl ?? CALIBRATION_TABLE_URL;
  const excluded: { path: string; reason: string }[] = [];

  // 1. One entry per path, in path order. The order is part of the contract: it is what
  //    makes the hash, the body and the commit the same across two runs.
  const seen = new Set<string>();
  const entries: FixedFile[] = [];
  for (const file of input.reports.flatMap((r) => r.files)) {
    if (seen.has(file.target)) {
      excluded.push({
        path: file.target,
        reason: 'listed twice in the input; the first entry was used',
      });
      continue;
    }
    seen.add(file.target);
    entries.push(file);
  }
  entries.sort((a, b) => a.target.localeCompare(b.target));

  const flagsOnly = (): PlanSummary => ({
    fixesApplied: 0,
    fixesRefused: entries.flatMap((e) => e.repairs).length,
    filesChanged: 0,
    filesExcluded: excluded,
    fixesDeferred: 0,
    flagsOmitted: 0,
  });

  if (entries.length > caps.files) {
    return {
      kind: 'nothing-to-open',
      reason:
        `${pluralise(entries.length, 'file')} were scanned, over the cap of ${String(caps.files)}. ` +
        'Marlo refuses to plan a pull request that size rather than opening part of one. Pass ' +
        'fewer files.',
      summary: flagsOnly(),
    };
  }

  // 2. Per file: separate fixes from flags, and refuse any file whose path may not be
  //    written or whose fixes collide.
  const work: FileWork[] = [];
  const extraFlags: Flag[] = [];
  let refusedByPath = 0;
  for (const entry of entries) {
    const fixes = [...entry.repairs.filter(isFix)].sort(byPosition);
    const flags = entry.repairs.filter(isFlag);
    const pathRefusal = refusedPath(entry.target);
    if (pathRefusal !== null) {
      if (fixes.length > 0) excluded.push({ path: entry.target, reason: pathRefusal });
      refusedByPath += fixes.length;
      work.push({ path: entry.target, source: entry.source, fixes: [], flags });
      continue;
    }
    const clashes = conflicts(fixes.flatMap((f) => f.edits));
    if (clashes.length > 0) {
      const described = clashes.map(describeConflict).join('; ');
      excluded.push({
        path: entry.target,
        reason: `two verified fixes touch the same bytes (${described})`,
      });
      for (const fix of fixes) {
        extraFlags.push(
          flagFromFix(
            fix,
            'conflicting-edits',
            `Two verified fixes in ${entry.target} touch the same bytes: ${described}. Each was ` +
              'verified against the original file and neither against the other, so applying both ' +
              'would apply something nobody checked. The whole file was left out of this pull request.',
          ),
        );
      }
      work.push({ path: entry.target, source: entry.source, fixes: [], flags });
      continue;
    }
    work.push({ path: entry.target, source: entry.source, fixes, flags });
  }

  const allFixes = work.flatMap((w) => w.fixes);
  const allFlags = [...work.flatMap((w) => w.flags), ...extraFlags];

  if (allFixes.length === 0) {
    const findings = allFlags.length;
    return {
      kind: 'nothing-to-open',
      reason:
        refusedByPath > 0
          ? `every verified fix is in a file a pull request may not write: ${excluded
              .map((x) => `${x.path} (${x.reason})`)
              .join('; ')}`
          : findings === 0
            ? 'no findings on the files scanned, so there is nothing to fix and nothing to flag.'
            : `${pluralise(findings, 'finding')}, none of which Marlo could fix and verify. Every ` +
              'one is a flag with the measurement or reason that disqualified it; run `marlo fix` ' +
              'on the same files to read them.',
      summary: {
        fixesApplied: 0,
        fixesRefused: findings + refusedByPath,
        filesChanged: 0,
        filesExcluded: excluded,
        fixesDeferred: 0,
        flagsOmitted: 0,
      },
    };
  }

  // 3. Decide how many fixes fit. Start at the fix cap and shrink only if the body cannot
  //    be brought under its cap with the flags section emptied. Bounded by the fix cap.
  const bodyFlags = allFlags.slice(0, caps.flagsInBody);
  let included = Math.min(allFixes.length, caps.fixes);

  for (; included > 0; included -= 1) {
    const chosen = allFixes.slice(0, included);
    const chosenSet = new Set(chosen);
    const deferred = allFixes.length - included;

    // The files the plan writes, with only the chosen fixes applied to each.
    const files: PlannedFile[] = [];
    const applied: VerifiedFix[] = [];
    const localExclusions: { path: string; reason: string }[] = [];
    for (const w of work) {
      const fixes = w.fixes.filter((f) => chosenSet.has(f));
      if (fixes.length === 0) continue;
      try {
        files.push({
          path: w.path,
          contents: applyEdits(
            w.source,
            fixes.flatMap((f) => f.edits),
          ),
        });
        applied.push(...fixes);
      } catch (error) {
        // The source in the report is not what the edits were computed against. Not a
        // conflict between fixes: a report that disagrees with itself, and the file is out.
        localExclusions.push({
          path: w.path,
          reason: `the edits did not apply to the source in the report: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }
    if (applied.length === 0) {
      return {
        kind: 'nothing-to-open',
        reason: `every file with a verified fix was excluded: ${[...excluded, ...localExclusions]
          .map((x) => `${x.path} (${x.reason})`)
          .join('; ')}`,
        summary: {
          fixesApplied: 0,
          fixesRefused: allFlags.length + allFixes.length + refusedByPath,
          filesChanged: 0,
          filesExcluded: [...excluded, ...localExclusions],
          fixesDeferred: 0,
          flagsOmitted: 0,
        },
      };
    }

    const edits = applied.flatMap((f) => f.edits);
    const branch = branchNameFor(edits);
    const rules = [...new Set(applied.map((f) => f.actRuleId))].sort();
    const successCriteria = [
      ...new Set<SuccessCriterion>([
        ...applied.flatMap((f) => f.successCriteria),
        ...bodyFlags.flatMap((f) => f.finding.successCriteria),
      ]),
    ].sort();
    const title = `Fix ${pluralise(applied.length, 'verified accessibility violation')} in ${pluralise(files.length, 'file')}`;
    const first = input.reports[0];

    // 4. The body, trimming flags until it fits. Bounded by the flags-in-body cap.
    for (let keep = bodyFlags.length; keep >= 0; keep -= 1) {
      const omitted = allFlags.length - keep;
      const summaryLine =
        `Marlo applied ${pluralise(applied.length, 'fix', 'fixes')} it verified across ` +
        `${pluralise(files.length, 'file')} (${rules.map((r) => `\`${r}\``).join(', ')}) and refused ` +
        `${pluralise(allFlags.length, 'finding')} it could not.` +
        (deferred > 0
          ? ` ${pluralise(deferred, 'more verified fix', 'more verified fixes')} did not fit under the cap of ` +
            `${String(caps.fixes)} per pull request and will be offered again once this one is merged.`
          : '') +
        (localExclusions.length > 0 || excluded.length > 0
          ? ` Left out entirely: ${[...excluded, ...localExclusions]
              .map((x) => `${x.path} (${x.reason})`)
              .join('; ')}.`
          : '');

      const body: PullRequestBody = PullRequestBodySchema.parse({
        title,
        summary: summaryLine,
        fixes: applied,
        flags: bodyFlags.slice(0, keep),
        coverage: mergeCoverage(input.reports),
        engines: first?.engines ?? [],
        renderer: first?.renderer ?? 'static',
        calibration: {
          generated: input.table.generated,
          commit: input.table.commit,
          url: calibrationUrl,
        },
        howToReject: {
          single:
            'Revert the hunk for that rule, or add the rule id to marlo.config.json under ' +
            '`never` and Marlo will not offer it again.',
          all: 'Close this pull request. Marlo will not reopen it for the same content.',
          permanently:
            'Set `open-pull-request: false` in the workflow, which is the default, or remove ' +
            'the Action.',
        },
        successCriteria,
        marloVersion: input.marloVersion,
        omittedFlags: omitted,
      });
      const rendered = renderPullRequestBody(body);
      if (rendered.length > caps.bodyCharacters) continue;

      return {
        kind: 'plan',
        branch,
        title,
        body: rendered,
        commitMessage: commitMessageFor(applied, files, rules),
        files,
        summary: {
          fixesApplied: applied.length,
          fixesRefused: allFlags.length + refusedByPath,
          filesChanged: files.length,
          filesExcluded: [...excluded, ...localExclusions],
          fixesDeferred: deferred,
          flagsOmitted: omitted,
        },
      };
    }
    // Even with no flags the body is over the cap. Drop a fix and try again.
  }

  return {
    kind: 'nothing-to-open',
    reason:
      `the body for a single verified fix exceeds ${String(caps.bodyCharacters)} characters, so no ` +
      'pull request can carry its evidence. Apply it locally with `marlo fix --write`.',
    summary: {
      fixesApplied: 0,
      fixesRefused: allFlags.length + refusedByPath,
      filesChanged: 0,
      filesExcluded: excluded,
      fixesDeferred: allFixes.length,
      flagsOmitted: 0,
    },
  };
}

/** `<scope>: <what changed>`, with the rules fixed listed in the body. */
function commitMessageFor(
  applied: readonly VerifiedFix[],
  files: readonly PlannedFile[],
  rules: readonly string[],
): string {
  const lines: string[] = [];
  lines.push(
    `a11y: apply ${pluralise(applied.length, 'verified accessibility fix', 'verified accessibility fixes')} across ${pluralise(files.length, 'file')}`,
  );
  lines.push('');
  lines.push('Each change was applied, the page re-rendered and every engine re-run to confirm');
  lines.push('the target rule closed, nothing else started failing and the edit is idempotent.');
  lines.push('The pull request body carries the evidence per fix.');
  lines.push('');
  lines.push('Rules fixed:');
  for (const rule of rules) {
    const count = applied.filter((f) => f.actRuleId === rule).length;
    const name = applied.find((f) => f.actRuleId === rule)?.finding.actRuleName ?? rule;
    lines.push(`  ${rule}  ${name} (${String(count)})`);
  }
  lines.push('');
  lines.push('Files:');
  for (const file of files) lines.push(`  ${file.path}`);
  return `${lines.join('\n')}\n`;
}
