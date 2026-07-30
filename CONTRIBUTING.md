# Contributing

The most useful thing you can send is a case where Marlo was wrong. Instructions for that are first, because everything else in this document is less important.

---

## Report a false positive

Marlo flagged something that is not a violation. This is the highest-value message this project can receive, and the path is deliberately the shortest one in the repository.

**[Open a false positive report](https://github.com/KarthikSubramanian07/Marlo/issues/new?template=false-positive.yml)**

You need the HTML snippet and what Marlo said. You do not need to know which ACT rule it was, which engine reported it, or why it happened. If you have the `marlo scan --json` output, attach it and skip the rest of the form.

Every confirmed false positive is added to the fixture corpus as a negative case, so the same mistake fails the build in future. If it changed a design rather than just a rule, it goes in [HONESTY.md](HONESTY.md) with what reported success and what changed as a result.

The same applies to false negatives: Marlo said clean, and it was not. Also valuable, slightly less so, because a missed violation is a gap and a false positive is a lie.

---

## Add an ACT rule

The primary contribution surface. Marlo implements a fraction of the 94 published ACT rules and the fraction is printed in the README with its denominator. Closing the gap is the work.

You should not need to read the pipeline. If you do, that is a bug in the rule interface and worth an issue on its own.

**One rule is one file, one registry entry, and one fixture set.**

```
packages/rules/src/rules/<slug>-<actId>.ts        the rule
packages/rules/src/rules/<slug>-<actId>.test.ts   the fixtures
```

The rule file exports one object:

```ts
import { defineRule } from '../define.js';

export default defineRule({
  actId: 'b5c3f8',                  // the ACT rule identifier, six characters
  name: 'HTML page has lang attribute',
  successCriteria: ['3.1.1'],       // WCAG 2.2 success criteria, from the ACT rule
  requires: ['dom'],                // renderer capabilities. See below.
  applicability: (page) => /* the nodes this rule applies to */,
  expectation: (target) => /* 'passed' | 'failed' | 'cantTell' */,
});
```

`requires` is not decoration. A rule that declares `['dom']` and secretly needs layout will pass under the default renderer and fail in a browser, which is a false negative Marlo cannot see. If your rule reads a computed style, a bounding box, or anything that depends on CSS having been applied, it requires `layout`, and it will correctly report `unsupported` rather than passing when the static renderer is active. This is [D-005](DECISIONS.md#d-005) and it is the difference between "no contrast problems were found" and "contrast was not examined".

### What the review standard actually is

A rule is merged when it has:

1. **The passing examples from the official test cases.** Every one, not a selection. They are already vendored in `corpus/act/testcases/<actId>/`, so this is a loop rather than transcription.
2. **The failing examples from the official test cases.** Same.
3. **The inapplicable examples.** These are the ones people skip and they are where over-broad applicability shows up.
4. **At least two negative cases of your own**: markup that resembles a violation and is not one. The official corpus does not contain your intuitions about what nearly-breaks.
5. **A measured accuracy that the calibration harness produced**, not one you estimated. Run `pnpm calibrate --rule <actId>` and paste the output into the pull request.

A rule whose measured accuracy is poor can still be merged. It gets published with its real numbers, the router sends that rule to whichever peer engine is better at it, and the table shows Marlo losing. That is the correct outcome and it is not a rejection. What cannot be merged is a rule with no measurement, because then the number in the table would be an assertion.

### The backlog is the funnel

[Issues labelled `type:new-rule`](https://github.com/KarthikSubramanian07/Marlo/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Anew-rule) are unimplemented rules, one per issue, each with its ACT identifier, its success criteria, its test case count, and a note on whether it needs layout. They are sized so that one is an afternoon. This is copied directly from the sibling PDF project, which built a working contributor funnel out of "one condition, one function, one fixture" and is the reason that idea is here.

---

## Add or correct an engine mapping

The second contribution surface, and the one with the least competition.

No accessibility engine publishes a machine-readable mapping from its own rule identifiers to ACT rule identifiers. This was checked rather than assumed: of Alfa's 89 exported rules, 76 carry non-criterion requirements and every one of them is a WCAG technique or an EAA reference. Never an ACT rule. Same for axe-core and HTML CodeSniffer.

So `packages/engines/src/<engine>/mapping.ts` is hand-written, and each entry is a judgment:

```ts
{
  engineRuleId: 'html-has-lang',
  actId: 'b5c3f8',
  kind: 'exact',        // 'exact' | 'partial' | 'superset'
  note: 'axe fires on the same condition. Verified against all 7 test cases.',
}
```

`kind` is where the honesty lives. `partial` means the engine catches some of the rule's failing examples and not others, which the harness will confirm or contradict. `superset` means the engine also fires on things the ACT rule does not cover, so its findings for this rule carry extra material that is not attributable to the rule.

A mapping entry needs the test case evidence in the pull request. A test fails on any entry whose claim the corpus contradicts, so an optimistic `exact` will not survive CI.

---

## Dispute a published number

If you think a figure in `calibration/table.json` is wrong, say so. **[Open a calibration dispute](https://github.com/KarthikSubramanian07/Marlo/issues/new?template=calibration-dispute.yml)**.

The number being wrong is a defect in the thing this project is for, so a dispute outranks a feature request. Include the rule, the engine, what the table says, and what you measured. If you cannot reproduce the table from a clean clone, that is the same issue and possibly a worse one.

---

## Setting up

```
git clone https://github.com/KarthikSubramanian07/Marlo.git
cd Marlo
pnpm install
pnpm check
```

No API keys, no browser download, no network after install. If any of that is untrue, it is a bug: the whole test suite passing offline against fixtures is a hard requirement, not an aspiration.

`pnpm check` runs what CI runs. Individually:

| Command              | What it does                                                                |
| -------------------- | --------------------------------------------------------------------------- |
| `pnpm typecheck`     | `tsc --build` across the workspace                                          |
| `pnpm lint`          | ESLint, dependency rules, prose rules, forbidden claims                     |
| `pnpm test`          | The unit project. No browser, no network                                    |
| `pnpm test:coverage` | The same with thresholds enforced                                           |
| `pnpm test:browser`  | Playwright and real Chromium. Needs `pnpm exec playwright install chromium` |
| `pnpm calibrate`     | Regenerates `calibration/table.json`                                        |
| `pnpm corpus:verify` | Confirms the vendored corpus matches its digests                            |

### The coverage number and why it is that number

Global thresholds are 87 percent statements, 88 lines, 90 functions, and 73 branches. Those are the measured figures rounded down, not targets: the gate fails on any regression and an improvement is a one-line pull request to raise the number.

They were 85/80/85/85 until the coverage job was written, at which point they failed on the first run. Nothing had ever invoked them. A threshold nothing checks is a claim, and this repository contains a script whose entire job is to fail the build on claims like that, so the episode is in [HONESTY.md](HONESTY.md).

**Branch coverage runs about 14 points below statement coverage, and that gap is structural.** Under `noUncheckedIndexedAccess` every array index yields `T | undefined`, so each `?.` and `??` guarding one is a branch, and many are unreachable by construction. Two were found while raising these numbers. One guarded a routing state the schema now forbids outright; the other was a second fallback narrowing something the logic had already narrowed. Both were deleted rather than tested, which is the right move: a test that constructs an impossible input to reach a defensive line makes the number better and the suite worse.

If you find another, prefer making the state unrepresentable over covering it.

Two modules are held at 100 with no exceptions:

- `packages/act/` implements the grading protocol. Every accuracy claim Marlo publishes is arithmetic performed here. A partially covered grading protocol means an unmeasured accuracy number, which is the failure this project exists to argue against.
- `packages/report/src/invariant.ts` is the one-directional invariant. If it has an uncovered branch, that branch is a path where Marlo reports clean while a peer engine reported a failure.

Raising a threshold is a normal pull request. Lowering one needs a reason in the body and, if it is one of the two held at 100, an entry in DECISIONS.md.

---

## Sign-off

Marlo uses the [Developer Certificate of Origin](https://developercertificate.org/), not a contributor licence agreement. Commit with `-s`:

```
git commit -s -m "rules: implement b5c3f8, page lang attribute"
```

That appends `Signed-off-by: Your Name <you@example.com>`, which is you stating you have the right to contribute the code. That is the whole mechanism: no bot to authorise, no account to link, no agreement to read.

It is a DCO rather than a CLA because the contribution this project most wants is a false positive report from someone who is annoyed that Marlo was wrong about their markup, and putting a legal document in front of that person is how you lose the message. Recorded as [D-001](DECISIONS.md#d-001).

Forgot it? `git commit --amend -s --no-edit`, or for a branch, `git rebase --signoff origin/main`.

---

## Commits

`<scope>: <what changed>`, imperative, lower case, no trailing full stop.

Scopes are the package or area: `rules`, `engines`, `act`, `calibrate`, `repair`, `report`, `cli`, `mcp`, `action`, `site`, `demo`, `ci`, `docs`, `deps`.

```
rules: implement b5c3f8, page lang attribute
engines: correct the axe mapping for c487ae to partial
calibrate: count cantTell as its own column rather than folding it into recall
```

The body explains why, if why is not obvious. The log should read like a story: rewrite history locally until it does. No `wip`, no `fix lint`, no `address review comments`.

Breaking changes get a `!` after the scope and a `BREAKING CHANGE:` paragraph. The changelog is generated from this, so a lazy subject line becomes a lazy release note.

---

## Pull requests

Small and single-purpose beats large. One rule per pull request is ideal.

Every pull request needs a title that says what changed, a body explaining the change and the reasoning, a test plan, a linked issue, and screenshots for anything visual. Green CI before merge.

If a pull request needs a decision that is not yours to make, leave it as a draft with a checklist of the decisions needed. Do not guess and do not merge. A draft with a clear question is more useful than a merged guess.

### What CI will check

Typecheck, lint, format, unit, integration, end to end, build, coverage thresholds, performance budget, and Marlo's own accessibility self-audit on every Marlo-authored surface at WCAG 2.2 AA with zero critical or serious findings.

Plus three that are specific to this project:

- **Calibration.** The table is regenerated and compared. A false positive rate regression or a coverage claim that drifts from the registry fails the build. This is a required check, not an advisory one.
- **Forbidden claims.** `scripts/check-claims.mjs` fails on any of the nine phrases in `scripts/lib/rule-data.mjs`, anywhere in the repository including generated output and golden files. Each is listed there with the reason it is refused, and the script prints that reason at you rather than just saying no. There is no suppression comment, by design. If you need to discuss one of those phrases in order to argue against it, write the argument so the literal string does not appear. This paragraph is written that way, and so is the entry in `CHANGELOG.md`.
- **Prose.** No em dashes, and no AI slop vocabulary. `scripts/check-prose.mjs` has the list.

---

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). One additional expectation specific to this project: assume that a person reporting an accessibility problem knows more about their own experience of it than you do about accessibility.

## Security

Do not open an issue for a vulnerability. [SECURITY.md](SECURITY.md) has the reporting path.
