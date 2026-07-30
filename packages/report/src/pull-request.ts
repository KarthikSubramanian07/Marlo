import type { PullRequestBody, VerifiedFix, Flag, Edit } from '@marlo/schema';
import { SEVERITY_PRESENTATION, formatCoverage } from '@marlo/schema';

/**
 * The generated pull request body. The other thing developers judge Marlo by.
 *
 * The template is strict and the order is the argument. A reviewer who reads only the
 * first screen should already know what was wrong, which success criterion it breaks, and
 * how to say no.
 *
 *   1. What was wrong, and which criterion.
 *   2. The exact diff, per fix, with the rationale on each edit.
 *   3. Which engines agreed, and how the fix was verified. Not "verified": the three
 *      questions verification answers, each answered.
 *   4. What Marlo refused to touch, with the evidence and the decision handed over.
 *   5. Coverage as a fraction, and the calibration table the accuracy claims came from.
 *   6. How to reject this, one fix or all of it or permanently.
 *
 * Section 6 is not politeness. Pull request remediation is opt-in and off by default
 * (D-011), and a pull request that does not say how to say no is not opt-in in practice.
 *
 * Fenced blocks compute their own fence length from the content, so an excerpt containing
 * backticks cannot break out of its block and into the surrounding markdown.
 */

/** A fence long enough to contain `content`. */
function fence(content: string): string {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function codeBlock(content: string, language = ''): string {
  const marks = fence(content);
  return `${marks}${language}\n${content}\n${marks}`;
}

/** Renders one edit as a unified-diff-shaped fragment a reviewer can read. */
function renderEdit(edit: Edit): string {
  const lines: string[] = [];
  lines.push(`**${edit.file}** · ${edit.kind}`);
  lines.push('');
  lines.push(codeBlock(`- ${edit.before}\n+ ${edit.after}`, 'diff'));
  lines.push('');
  lines.push(edit.rationale);
  if (edit.insertedElement !== null) {
    lines.push('');
    lines.push(`Inserts a \`${edit.insertedElement}\` element.`);
  }
  return lines.join('\n');
}

function renderFix(fix: VerifiedFix, index: number): string {
  const lines: string[] = [];
  const presentation = SEVERITY_PRESENTATION[fix.finding.severity];

  lines.push(`### ${String(index)}. ${fix.finding.actRuleName}  \`${fix.actRuleId}\``);
  lines.push('');
  lines.push(
    `${presentation.mark} **${presentation.label}**  ` +
      `WCAG ${fix.successCriteria.join(', ')}  ` +
      `[ACT rule ${fix.actRuleId}](https://act-rules.github.io/rules/${fix.actRuleId})`,
  );
  lines.push('');
  lines.push(`**What was wrong.** ${fix.finding.verdict.message}`);
  lines.push('');
  lines.push(`**What changed.** ${fix.summary}`);
  lines.push('');

  for (const edit of fix.edits) lines.push(renderEdit(edit), '');

  // Verification, answered as three questions rather than asserted as one word.
  const v = fix.verification;
  lines.push('**How this was verified.**');
  lines.push('');
  lines.push('| Question | Answer |');
  lines.push('|---|---|');
  lines.push(`| Did \`${fix.actRuleId}\` stop failing? | ${v.targetClosed ? 'Yes' : 'No'} |`);
  lines.push(`| Did anything else start failing? | ${v.noNewViolations ? 'No' : 'Yes'} |`);
  lines.push(`| Is the change idempotent? | ${v.idempotent ? 'Yes' : 'No'} |`);
  lines.push(`| Re-run on | ${v.enginesRun.join(', ')} |`);
  lines.push('');
  lines.push('Outcome per engine after the change:');
  lines.push('');
  lines.push('| Engine | Outcome |');
  lines.push('|---|---|');
  for (const after of v.outcomesAfter) {
    lines.push(`| ${after.engine} | ${after.outcome} |`);
  }
  lines.push('');

  const agreed = [fix.finding.reportedBy, ...fix.finding.agreedBy];
  lines.push(
    `**Which engines agreed it was broken.** ${agreed.join(', ')}` +
      (fix.finding.disagreements.length > 0
        ? `. Disagreeing: ${fix.finding.disagreements.map((d) => `${d.engine} said ${d.outcome}`).join(', ')}.`
        : '.'),
  );
  lines.push('');
  lines.push(`**How to reject just this one.** ${fix.howToReject}`);
  return lines.join('\n');
}

function renderFlag(flag: Flag, index: number): string {
  const lines: string[] = [];
  const presentation = SEVERITY_PRESENTATION[flag.finding.severity];

  lines.push(`### ${String(index)}. ${flag.finding.actRuleName}  \`${flag.finding.actRuleId}\``);
  lines.push('');
  lines.push(
    `${presentation.mark} **${presentation.label}**  ` +
      `WCAG ${flag.finding.successCriteria.join(', ')}  ` +
      `not fixed: **${flag.reason}**`,
  );
  lines.push('');
  lines.push(`**What is wrong.** ${flag.finding.verdict.message}`);
  lines.push('');
  lines.push(
    `**Where.** ${
      flag.finding.source === null
        ? `${flag.finding.verdict.target.selector} (Marlo could not locate this in source: ${flag.finding.locationNote ?? 'no reason recorded'})`
        : `${flag.finding.source.file}:${String(flag.finding.source.line)}:${String(flag.finding.source.column)}`
    }`,
  );
  lines.push('');
  lines.push(`**Why Marlo did not fix it.** ${flag.explanation}`);
  lines.push('');
  lines.push(`**What you need to decide.** ${flag.humanDecision}`);
  lines.push('');
  lines.push(`**Corroborated by.** ${flag.corroboratedBy.join(', ')}`);

  if (flag.thresholdEvidence !== null) {
    const e = flag.thresholdEvidence;
    lines.push('');
    lines.push(
      `**The measurement behind that decision.** Strict precision ` +
        `${e.strictPrecision === null ? 'not measured' : e.strictPrecision.toFixed(2)} over ` +
        `${String(e.sampleSize)} official test cases, against a threshold of ${e.threshold.toFixed(2)}.`,
    );
  }

  if (flag.unverifiedEdits.length > 0) {
    lines.push('');
    lines.push(
      '**A change Marlo generated and could not verify.** Not applied. Included so you can judge it:',
    );
    lines.push('');
    for (const edit of flag.unverifiedEdits) lines.push(renderEdit(edit), '');
  }

  return lines.join('\n');
}

export function renderPullRequestBody(body: PullRequestBody): string {
  const out: string[] = [];

  out.push(body.summary);
  out.push('');
  out.push(
    `Every change below was applied, the page was re-rendered, and every engine was re-run to ` +
      `confirm the target criterion closed and nothing else broke. Anything Marlo could not verify ` +
      `is in **What Marlo did not fix** rather than in the diff.`,
  );
  out.push('');

  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Verified fixes | ${String(body.fixes.length)} |`);
  out.push(`| Flagged for a human | ${String(body.flags.length)} |`);
  out.push(`| Success criteria touched | ${body.successCriteria.join(', ') || 'none'} |`);
  out.push(`| Engines | ${body.engines.map((e) => `${e.id} ${e.version}`).join(', ')} |`);
  out.push(`| Renderer | ${body.renderer} |`);
  out.push(`| Coverage | ${formatCoverage(body.coverage)} |`);
  out.push('');

  if (body.fixes.length > 0) {
    out.push('## What was fixed');
    out.push('');
    body.fixes.forEach((fix, i) => {
      out.push(renderFix(fix, i + 1));
      out.push('');
    });
  }

  if (body.flags.length > 0) {
    out.push('## What Marlo did not fix');
    out.push('');
    out.push(
      'Each of these is a real finding Marlo declined to change. The reason is stated, the ' +
        'evidence is attached, and the decision is yours.',
    );
    out.push('');
    body.flags.forEach((flag, i) => {
      out.push(renderFlag(flag, i + 1));
      out.push('');
    });
  }

  out.push('## The accuracy these claims rest on');
  out.push('');
  out.push(
    `Marlo covers ${formatCoverage(body.coverage)}. Of those, ${String(body.coverage.calibrated)} ` +
      'have measured accuracy against the official ACT test cases.',
  );
  if (body.coverage.unmeasurable.length > 0) {
    out.push('');
    out.push(
      `${String(body.coverage.unmeasurable.length)} implemented rule(s) have no official test cases, ` +
        `so their accuracy is unmeasured: ${body.coverage.unmeasurable.map((r) => `\`${r}\``).join(', ')}.`,
    );
  }
  if (body.coverage.notEvaluated.length > 0) {
    out.push('');
    out.push(
      `${String(body.coverage.notEvaluated.length)} rule(s) were **not evaluated** because the ` +
        `${body.renderer} renderer does not provide a capability they need. That is not a pass: ` +
        body.coverage.notEvaluated
          .map((n) => `\`${n.actRuleId}\` needs ${n.missing.join(' and ')}`)
          .join(', ') +
        '.',
    );
  }
  out.push('');
  out.push(
    `Calibration table generated ${body.calibration.generated}` +
      (body.calibration.commit === null ? '' : ` at \`${body.calibration.commit}\``) +
      `. [Look up any number in it](${body.calibration.url}).`,
  );
  out.push('');

  out.push('## How to reject this');
  out.push('');
  out.push(`- **One change:** ${body.howToReject.single}`);
  out.push(`- **All of it:** ${body.howToReject.all}`);
  out.push(`- **Permanently:** ${body.howToReject.permanently}`);
  out.push('');
  out.push(
    'Marlo opened this pull request and cannot merge it. It does not push to your default ' +
      'branch, force push, rewrite history, or deploy.',
  );

  return `${out.join('\n')}\n`;
}

/** The title. Imperative, scoped, no trailing full stop. */
export function pullRequestTitle(body: PullRequestBody): string {
  return body.title;
}
