# Handoff

What is real, what is a stub, what is deferred, and where the traps are. Written for the next person, who may be me in three months with no memory of any of this.

Read [ARCHITECTURE.md](ARCHITECTURE.md) first for the shape. This file is the state.

## Real, measured, and merged

Everything in this list runs with no API key, no network after `pnpm install` and no browser.

|                                                            | Evidence                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The ACT corpus, vendored                                   | 1134 test cases across 91 rules, SHA-256 per file, `pnpm corpus:verify`                 |
| The grading protocol and both accuracy views               | `packages/act`, every line and branch covered                                           |
| Three peer engine adapters                                 | axe-core, Alfa, HTML CodeSniffer, in-process                                            |
| 35 of Marlo's own ACT rules                                | `packages/rules/src/registry.ts`                                                        |
| The calibration table                                      | 164 engine-rule measurements, `calibration/table.json`, regenerated in CI               |
| Routing and the one-directional invariant                  | `packages/report/src/invariant.ts`, 256-case exhaustive test                            |
| Terminal, JSON, SARIF 2.1.0 and pull request body surfaces | `packages/report`                                                                       |
| A working CLI                                              | `marlo scan`, `explain`, `coverage`                                                     |
| The website                                                | [trymarlo.pages.dev](https://trymarlo.pages.dev), every number generated from the table |
| The dogfood gate                                           | `pnpm screenshots`, three widths, both colour schemes, axe-core, tap targets, overflow  |

404 tests. `pnpm check` is what CI runs and there is nothing CI runs that it does not.

## Stubbed, on purpose, and honest about it

**What repair will not do, which is most of it.** Seven rules have a mechanical codemod, and on the current table only two clear the measured auto-fix threshold. The other five come back as flags with the generated change attached and not applied, carrying the precision that disqualified them. That is the gate working: a codemod for a rule whose detection is right 29 percent of the time would apply four wrong edits for every right one. The list of rules with **no** codemod is longer still, and the comment at the top of `codemod.ts` says which kind of human decision each one needs.

**The language provider.** Default is a deterministic stub returning fixed strings. Real provider behind `MARLO_LANGUAGE_PROVIDER=anthropic`. There is no silent upgrade path: the stub never falls through to a network call, and the tests run against the stub, so the suite is green offline by construction rather than by luck.

**`RemoteRenderer`.** Constructs, declares its capabilities, and throws when you render. It exists to hold the shape of the seam and to name the first dollar of variable cost in one place. See [D-007](DECISIONS.md#d-007).

**The browser renderer is real but optional.** Playwright is not a dependency. Absent it, layout-dependent and paint-dependent rules report `unsupported`, which is visible in the output above the findings, not a pass.

## Deferred, with the honest reason

None of these are hidden behind a flag that does nothing.

|                                       | Issue                                                          | Why it is not here                                                                                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Golden files for the browser renderer | [#37](https://github.com/KarthikSubramanian07/Marlo/issues/37) | The static path has committed golden output and a CI job. The browser path rests on manual runs, so a divergence between the two would show up as a mystery rather than as a diff.                                                                                  |
| The other 59 ACT rules                | [#38](https://github.com/KarthikSubramanian07/Marlo/issues/38) | A backlog rather than a task, and it stays open on purpose: a public project needs a start-here issue. Four rules are currently routed to nobody at all, and those are the ones where an implementation changes what Marlo can see rather than only who reports it. |
| A performance budget in CI            |                                                                | Accuracy and coverage are gated. Nothing gates time, so a rule that gets ten times slower passes.                                                                                                                                                                   |
| A parse-only renderer                 |                                                                | The default renderer executes inline page script. [HONESTY.md](HONESTY.md#1-a-security-option-that-did-nothing) explains that and does not excuse it.                                                                                                               |
| Repair over a pull request            |                                                                | `marlo fix` writes to files. The pull request surface is opt-in per [D-011](DECISIONS.md#d-011) and the body renderer is written and tested; nothing wires it to an API yet.                                                                                        |

**Repair is no longer on this list.** `@marlo/repair` locates source, generates minimal diffs for seven rules, and verifies each one before applying it. What it will not do is the interesting part, and it is in the next section.

## Traps

Things that will cost you an hour if nobody tells you.

**Vitest aliases workspace packages to source, per project.** `vitest.config.ts` reads `packages/` off disk and rebuilds the alias map inside **every** project entry, because Vitest 4 does not inherit the root `resolve`. Without it, `pnpm test` on a clean checkout cannot resolve `@marlo/schema`. If you add a package and its tests cannot find a sibling, this is why.

**`scripts/lib/rule-data.mjs` is the only file the claim and prose scanners skip.** It has to be, because a pattern forbidding a phrase contains the phrase. Do not add a second exclusion; `rule-data.test.mjs` asserts the skip list is exactly one path and will fail. If you need to quote a forbidden phrase, put it in that file's data.

**Never write `packages/*/src/**` inside a block comment.** The star-slash closes the comment early. This produced `ReferenceError: src is not defined` and took a while to see. Write it in words.

**Node floor is 22.13.0** and it is not arbitrary: vite 8 needs 22.12, watskeburt 6 needs ^22.13. `.nvmrc` and `engines.node` must move together.

**ESLint needs headroom.** Sixteen typed projects will abort with a SIGABRT under the default heap. `lint:code` sets `--max-old-space-size=6144`. Do not remove it.

**Prettier reformats markdown tables.** Run `pnpm format` before committing docs or CI will fail the format check on whitespace.

**A sync tool has put `filename 2.mjs` duplicates in this repository twice**, and one of them blocked a `git checkout` mid-rebase. `pnpm lint:duplicates` now fails the build on them. If it fires, delete the file rather than renaming it.

**The corpus job in CI runs bare `node`.** It has no pnpm, deliberately, so corpus verification cannot be broken by a dependency problem.

## If a published number changes

Not a merge conflict to resolve. A result to investigate.

`pnpm calibrate:check` fails on a **regression and on an unrecorded improvement**, because a number moving up without anyone knowing why is the same problem as one moving down. Regenerate with `pnpm calibrate`, look at the diff per rule, and if a number improved, find out which change did it before committing it. [HONESTY.md](HONESTY.md#4-the-measurement-was-wrong-before-the-code-was) has two cases where an improvement was the bug.

## What I would do first

1. **Raise the precision of the rules that already have a codemod.** Five of the seven are refused by the gate rather than by a missing implementation, and `24afc2`, `78fd32` and `9e45ec` are all Marlo's own rules measuring between 0.29 and 0.33. Every point of precision there converts a flag into a fix, which is a much better return than a new rule.
2. **Make `e6952f` detectable.** The codemod for it exists and works, and no engine reports the rule, so nothing ever calls it. Source location is what makes the rule visible at all, and that now exists. This is the shortest path from written code to a working fix.
3. **Browser renderer golden files** ([#37](https://github.com/KarthikSubramanian07/Marlo/issues/37)). The claim that the same rule set reports genuine results under a real browser deserves a committed file rather than a manual run.

## What needs a person, not a script

See [SETUP.md](SETUP.md#manual-steps-that-remain). Four items: branch protection, the shorter domain if you want it, npm publication, and a language provider key if you ever want generated descriptions.
