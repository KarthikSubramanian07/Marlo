# Handoff

What is real, what is a stub, what is deferred, and where the traps are. Written for the next person, who may be me in three months with no memory of any of this.

Read [ARCHITECTURE.md](ARCHITECTURE.md) first for the shape. This file is the state.

## Real, measured, and merged

Everything in this list runs with no API key and no network after `pnpm install`. Only the rows marked as browser need Playwright, and `pnpm check` needs none of them.

|                                                            | Evidence                                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| The ACT corpus, vendored                                   | 1134 test cases across 91 rules, SHA-256 per file, `pnpm corpus:verify`                                                                   |
| The grading protocol and both accuracy views               | `packages/act`, every line and branch covered                                                                                             |
| Three peer engine adapters                                 | axe-core, Alfa, HTML CodeSniffer: in-process on the static renderer, inside the page on the browser renderer                              |
| 41 of Marlo's own ACT rules                                | `packages/rules/src/registry.ts`                                                                                                          |
| Contrast with a paint-order walk                           | `packages/rules/src/colour.ts` and `paint.ts`; declines with a named element wherever one ratio would be a guess                          |
| The calibration tables                                     | `calibration/table.json` (static, the published headline) and `calibration/browser.json`; the static one is checked on every pull request |
| A second corpus of real pages                              | 25 pages in `corpus/real`, digest-verified, measured separately, with a two-rater adjudication protocol and empty worksheets              |
| Routing and the one-directional invariant                  | `packages/report/src/invariant.ts` per rule, 256-case exhaustive test; `elements.ts` per element, with property tests                     |
| Terminal, JSON, SARIF 2.1.0 and pull request body surfaces | `packages/report`                                                                                                                         |
| A working CLI                                              | `marlo scan` on either renderer, `fix`, `explain`, `coverage`                                                                             |
| Repair that opens a pull request                           | `packages/repair/src/pull-request.ts` and `github.ts`, opt-in in the Action, idempotent by branch name                                    |
| The browser renderer, evaluated                            | Every engine runs in the page; golden output under `tests/golden/browser/`, its own CI job                                                |
| The website                                                | [trymarlo.pages.dev](https://trymarlo.pages.dev), every number generated from the table                                                   |
| The dogfood gate                                           | `pnpm screenshots`, three widths, both colour schemes, axe-core, tap targets, overflow                                                    |

`pnpm check` is what CI runs, apart from the jobs that need a browser or a build, and every one of those is a required check too.

## Stubbed, on purpose, and honest about it

**What repair will not do, which is most of it.** Seven rules have a mechanical codemod, and on the current table only two clear the measured auto-fix threshold. The other five come back as flags with the generated change attached and not applied, carrying the precision that disqualified them. That is the gate working: a codemod for a rule whose detection is right 29 percent of the time would apply four wrong edits for every right one. The list of rules with **no** codemod is longer still, and the comment at the top of `codemod.ts` says which kind of human decision each one needs.

**The language provider.** Default is a deterministic stub returning fixed strings. Real provider behind `MARLO_LANGUAGE_PROVIDER=anthropic`. There is no silent upgrade path: the stub never falls through to a network call, and the tests run against the stub, so the suite is green offline by construction rather than by luck.

**`RemoteRenderer`.** Constructs, declares its capabilities, and throws when you render. It exists to hold the shape of the seam and to name the first dollar of variable cost in one place. See [D-007](DECISIONS.md#d-007).

**The browser renderer is real but optional.** Playwright is not a dependency. Absent it, layout-dependent and paint-dependent rules report `unsupported`, which is visible in the output above the findings, not a pass. With it, every engine runs inside the page and `--renderer browser` reads its own calibration table.

**Shadow trees are not entered.** Marlo's document view leaves shadow content out, because IDs and ID references are scoped per tree and folding the trees together would invent duplicates. On a page with shadow roots, every element rule adds a `cantTell` naming how many it did not examine, so the page cannot read as clean. The static renderer does not build the shadow roots that page script attaches at all, so there the content is simply absent.

## Deferred, with the honest reason

None of these are hidden behind a flag that does nothing.

|                            | Issue                                                          | Why it is not here                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rating the real pages      |                                                                | The protocol, tooling and empty worksheets are committed. It needs two people, rating independently, and their disagreements written down. Until then the table carries no real-page accuracy figure and refuses one.                                                                                                                                                                                                       |
| The other 53 ACT rules     | [#38](https://github.com/KarthikSubramanian07/Marlo/issues/38) | A backlog rather than a task. The tracking issue is closed and no per-rule `type:new-rule` issue is open, so a newcomer currently has no start-here issue; filing one per unimplemented rule is the cheapest fix for that. No claimed rule is routed to nobody any more: `b40fd1` went to Marlo with the bypass blocks rules. `3e12e1` is the one that would let `cf77f2` fail on pages with script, which is most of them. |
| Entering shadow trees      |                                                                | Needs per-tree id scoping in the document view and in every rule that resolves an id reference. Until then element rules decline on pages with shadow content.                                                                                                                                                                                                                                                              |
| A performance budget in CI |                                                                | Accuracy and coverage are gated. Nothing gates time, so a rule that gets ten times slower passes.                                                                                                                                                                                                                                                                                                                           |
| A parse-only renderer      |                                                                | The default renderer executes inline page script. [HONESTY.md](HONESTY.md#1-a-security-option-that-did-nothing) explains that and does not excuse it.                                                                                                                                                                                                                                                                       |

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

1. **Rate the real pages.** Two people, the protocol in `corpus/real/adjudication/PROTOCOL.md`, and `node scripts/adjudicate.mjs`. It is the only way the project gets a number that describes the pages people actually scan, and the agreement between the two raters is a ceiling on what any tool can score, which belongs on the website either way.
2. **Raise the precision of the rules that already have a codemod.** Five of the seven are refused by the gate rather than by a missing implementation, and `24afc2`, `78fd32` and `9e45ec` are Marlo's own rules. Every point of precision there converts a flag into a fix.
3. **Make `e6952f` detectable.** The codemod for it exists and works, and no engine reports the rule, so nothing ever calls it.
4. **Enter shadow trees** with per-tree id scoping, so element rules stop declining on component-heavy pages.

## What needs a person, not a script

See [SETUP.md](SETUP.md#manual-steps-that-remain): the shorter domain if you want it, npm publication, and a language provider key if you ever want generated descriptions. Two more since then: the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets, without which the deploy workflow fails on purpose and the site is published by hand, and two people to rate the real pages.
