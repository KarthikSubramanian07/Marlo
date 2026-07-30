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

**The language provider.** Default is a deterministic stub returning fixed strings. Real provider behind `MARLO_LANGUAGE_PROVIDER=anthropic`. There is no silent upgrade path: the stub never falls through to a network call, and the tests run against the stub, so the suite is green offline by construction rather than by luck.

**`RemoteRenderer`.** Constructs, declares its capabilities, and throws when you render. It exists to hold the shape of the seam and to name the first dollar of variable cost in one place. See [D-007](DECISIONS.md#d-007).

**The browser renderer is real but optional.** Playwright is not a dependency. Absent it, layout-dependent and paint-dependent rules report `unsupported`, which is visible in the output above the findings, not a pass.

## Deferred, with the honest reason

None of these are hidden behind a flag that does nothing.

|                                                          | Issue                                                          | Why it is not here                                                                                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repair, source location, minimal diff                    | [#10](https://github.com/KarthikSubramanian07/Marlo/issues/10) | The largest single piece of remaining work. `marlo fix` exits 2 with a message saying so. Nothing in the codebase claims to repair anything.                                  |
| The verification loop                                    | [#11](https://github.com/KarthikSubramanian07/Marlo/issues/11) | Depends on repair. The type already forbids the failure mode: `Repair` is `VerifiedFix                                                                                        | Flag`, so an unverified fix has no representation. |
| MCP server                                               | [#14](https://github.com/KarthikSubramanian07/Marlo/issues/14) | Thin wrapper over `@marlo/cli`'s pipeline once repair exists. Read-only tools would work today.                                                                               |
| GitHub Action                                            | [#15](https://github.com/KarthikSubramanian07/Marlo/issues/15) | The safety boundary it enforces is already asserted in `packages/cli`; the Action is packaging.                                                                               |
| The deliberately broken demo app                         | [#16](https://github.com/KarthikSubramanian07/Marlo/issues/16) | The CLI has been run against real broken markup, and that is how the HTML CodeSniffer crash and the JSON truncation were found. The committed golden files are not there yet. |
| Coverage gate at a defensible number, performance budget | [#18](https://github.com/KarthikSubramanian07/Marlo/issues/18) | Thresholds are enforced (85/80/85/85, and 100% on two paths). A timing budget is not.                                                                                         |

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

1. **The repair layer** ([#10](https://github.com/KarthikSubramanian07/Marlo/issues/10)). It is the difference between a measured scanner and the product described in the README. Start with source location, since every diff needs it, and start with the three rules whose strict precision is already above 0.95 so the auto-fix threshold has something to admit.
2. **Verify `unsupported` end to end** with Playwright installed. The static path is well tested. The claim that the same rule set reports genuine results under a real browser deserves a committed golden file rather than a manual run.
3. **Widen the corpus for the rules Marlo scores worst on.** `5c01ea` is officially consistent with a strict recall of 0.000, which is the flattery case the project was built to expose, and it is ours.

## What needs a person, not a script

See [SETUP.md](SETUP.md#manual-steps-that-remain). Four items: branch protection, the shorter domain if you want it, npm publication, and a language provider key if you ever want generated descriptions.
