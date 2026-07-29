# Plan

The build order, the stack and why, the branch map, and the risks being carried. Written after [RESEARCH.md](RESEARCH.md) and before any product code.

---

## 1. What is being built

A pipeline with a published error rate. The pipeline is not the interesting part; the error rate is.

```
source ──▶ render ──▶ engines ──▶ normalise ──▶ route ──▶ locate ──▶ repair ──▶ verify ──▶ report
             │          │            │            │                              │
             │          │         ACT rule     calibration                   re-render
             │          │           ids          table                       re-scan
             │          │
             │        axe-core, Alfa, HTML CodeSniffer, @marlo/rules
             │
        happy-dom (default) | Playwright (opt-in) | remote (seam)
```

Two artifacts are load-bearing and everything else is a consumer of them:

1. **The calibration table**, `calibration/table.json`. Per ACT rule, per engine, measured against the 1134 official test cases. Regenerated in CI. Every confidence score, every routing decision, and every claim on the website reads from it.
2. **The verification result**, attached to every fix. A fix without one is not a fix, it is a flag.

---

## 2. Stack, with the reasoning

**TypeScript on Node 22, strict, `pnpm` workspaces.**

The decision worth defending is that the codemod core is TypeScript rather than Rust compiled to WASM. The brief explicitly permitted Rust and asked for the tradeoff.

Against Rust: the four engineers who inherit this are being handed a project whose contribution funnel is _new ACT rule implementations_. A rule is a pure function over a DOM. The single most important property of this repository is that a contributor can add a rule without reading the pipeline. A Rust-to-WASM core means a contributor adding a rule needs a Rust toolchain, needs to understand the WASM boundary, and cannot use the same DOM types the rest of the codebase uses. That cost is paid on every contribution, forever.

For Rust: parser performance, and memory safety in the edit-application path.

The measurement that settles it: the whole pipeline against the demo app, including three engines and re-verification, runs in well under a second in-process. There is no performance problem to solve. Choosing Rust would be buying a solution to a problem this project does not have, and paying for it in the one currency it cannot afford. Recorded as [D-002](DECISIONS.md#d-002).

**happy-dom over jsdom or linkedom.** All three adopted engines run under it, which was measured, and it implements `getComputedStyle` and `createRange`, which linkedom does not and which Alfa and several rules need. jsdom would also work and is more widely trusted; happy-dom is faster and was the one that ran all three engines first attempt. Noted as a reversible choice behind the `Renderer` interface.

**Vitest.** Same runtime as the code, native TypeScript, and it runs the browser-dependent tests and the pure tests in one command.

**Zod at every trust boundary.** Engine output, calibration table on load, MCP tool arguments, Action inputs, CLI config file, and the site's API responses. Parsing untrusted JSON into a typed value without validating it is how a calibration table quietly becomes wrong.

**Cloudflare Pages for the site, one Worker for the calibration API.** The site is generated to static HTML at build time by a script in the repository, because a site whose subject is verifiable accuracy should be inspectable as files. No framework: the whole site is nine pages and a build script, and a React runtime would be more code than the site.

**Playwright as an optional dependency.** Needed for the browser renderer, the screenshots, and the site's accessibility self-audit. Not needed for `pnpm test` to pass, which is a hard requirement: no network, no API keys, no browser binary, green.

### Cost, stated as a claim that can be checked

| Component                     | Where it runs                    | Cost at any scale                                            |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------ |
| CLI, library, MCP server      | The caller's machine             | Zero                                                         |
| Engines, static renderer      | In-process                       | Zero                                                         |
| Calibration regeneration      | GitHub Actions, public repo      | Zero, unmetered                                              |
| Browser renderer, screenshots | The caller's machine or their CI | Zero, unmetered on public repos                              |
| Site                          | Cloudflare Pages, static         | Zero, no egress charge                                       |
| Calibration API               | One Worker, free tier            | Zero within 100k requests/day                                |
| `RemoteRenderer`              | Cloudflare Browser Rendering     | **The first dollar.** Seam only. [D-007](DECISIONS.md#d-007) |

No fixed monthly floor. Nothing that becomes a bill when the project gets popular except the one component that is deliberately not built.

---

## 3. Package layout

Pure logic is separated from I/O by package boundary, not by convention. `schema`, `act`, and `rules` have no I/O and no framework imports at all; a test asserting that is part of the lint step.

| Package            | I/O                  | Responsibility                                                                                           |
| ------------------ | -------------------- | -------------------------------------------------------------------------------------------------------- |
| `@marlo/schema`    | none                 | Every artifact type, and its Zod validator. The vocabulary.                                              |
| `@marlo/act`       | reads corpus at init | The 94 rules, WCAG mappings, the official grading protocol, coverage arithmetic.                         |
| `@marlo/rules`     | none                 | Marlo's own ACT rule implementations. One rule, one function, one fixture set. The contribution surface. |
| `@marlo/render`    | DOM, browser         | The renderer seam and the capability model.                                                              |
| `@marlo/engines`   | via render           | Peer engine adapters and the hand-written engine-rule to ACT-rule mappings.                              |
| `@marlo/calibrate` | fs                   | Runs engines over the corpus, produces the table, computes both accuracy views.                          |
| `@marlo/repair`    | fs                   | Locate, generate byte-range edits, apply, verify. Property-tested.                                       |
| `@marlo/report`    | none                 | SARIF, terminal output, PR body, JSON. The one-directional invariant.                                    |
| `@marlo/cli`       | everything           | `marlo scan`, `marlo fix`, `marlo calibrate`, `marlo explain`.                                           |
| `@marlo/mcp`       | stdio                | `marlo_check`, `marlo_repair`, `marlo_explain`, `marlo_calibration`.                                     |
| `@marlo/action`    | GitHub               | CI gate and PR comment.                                                                                  |
| `apps/demo`        | fixtures             | The deliberately broken app. Fixtures with a story.                                                      |
| `apps/site`        | Cloudflare           | `trymarlo.pages.dev`.                                                                                    |

`@marlo/rules` importing anything from `@marlo/engines` would invert the dependency and make Marlo's own engine unmeasurable against its peers on equal terms. Enforced by a dependency-cruiser rule, not by asking nicely.

---

## 4. Build order

Dependency order, so `main` stays deployable at every merge.

| #   | Branch                  | Delivers                                                                                          | Depends on |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| 1   | `docs/research-gate`    | RESEARCH.md, PLAN.md, DECISIONS.md, licence ledger                                                | nothing    |
| 2   | `chore/repo-foundation` | Workspace, strict TS, lint, format, hooks, CI skeleton, community health files, labels, templates | 1          |
| 3   | `feat/act-corpus`       | Vendored corpus, `@marlo/act`, grading protocol, coverage arithmetic                              | 2          |
| 4   | `feat/schema`           | `@marlo/schema`                                                                                   | 2          |
| 5   | `feat/render-seam`      | `@marlo/render`, capability model                                                                 | 4          |
| 6   | `feat/engines`          | `@marlo/engines`, three adapters, ACT mappings                                                    | 3, 5       |
| 7   | `feat/marlo-rules`      | `@marlo/rules`, accessible name computation, the rule set                                         | 3, 4       |
| 8   | `feat/calibration`      | `@marlo/calibrate`, `calibration/table.json`, the CI job that asserts it                          | 6, 7       |
| 9   | `feat/routing`          | Routing, one-directional invariant, confidence scoring                                            | 8          |
| 10  | `feat/repair`           | Locate, edits, codemods, alt-text policy, property tests                                          | 7, 9       |
| 11  | `feat/verify`           | The verification loop                                                                             | 10         |
| 12  | `feat/report`           | SARIF, terminal, PR body, forbidden-claims check                                                  | 9, 11      |
| 13  | `feat/cli`              | `@marlo/cli`                                                                                      | 12         |
| 14  | `feat/mcp`              | `@marlo/mcp`                                                                                      | 12         |
| 15  | `feat/action`           | `@marlo/action`, safety boundary in scopes                                                        | 12         |
| 16  | `feat/demo-app`         | `apps/demo`, end-to-end test, golden diff and PR body                                             | 13         |
| 17  | `feat/site`             | `apps/site`, SEO, OG images, no-theatre tests                                                     | 8          |
| 18  | `ci/hardening`          | Full pipeline, coverage gate, perf budget, self-audit, supply chain                               | 16, 17     |
| 19  | `docs/handoff`          | HANDOFF, WORKSTREAMS, HONESTY, screenshots, README                                                | 18         |

---

## 5. The rule set for this pass

Chosen from the 94 published rules on three criteria: decidable from the DOM without layout, carries official test cases, and sits in a category the product spec commits to. Grouped by what Marlo does with a finding.

**Auto-fix candidates**, where the correct repair is unambiguous and verifiable:
`b5c3f8` page lang · `bf051a` page lang valid · `de46e4` element lang valid · `5b7ae0` lang and xml:lang match · `5f99a7` ARIA attribute defined · `6a7281` ARIA value valid · `5c01ea` ARIA property permitted · `674b10` role value valid · `3ea0c8` unique id · `e6952f` no duplicate attribute · `bc659a` meta refresh · `bisz58` meta refresh strict · `b4f0c3` viewport zoom · `78fd32` line height · `24afc2` letter spacing · `9e45ec` word spacing · `73f2c2` autocomplete valid · `e88epe` decorative image not in tree · `46ca7f` decorative not exposed

**Detect and locate, fix only where the page supplies the meaning:**
`23a2a8` image name · `c487ae` link name · `97a4e1` button name · `e086e5` form field name · `ffd0e9` heading name · `cae760` iframe name · `59796f` image button name · `9eb3f6` filename as name

**Detect and locate, never auto-fix:**
`afw4f7` minimum contrast · `09o5cg` enhanced contrast (both `layout`-capability, so `unsupported` under the default renderer, never a pass) · `6cfa84` aria-hidden focusable content · `bc4a75` required owned elements · `ff89c9` required context role · `047fe0` heading for non-repeated content · `b40fd1` landmark for non-repeated content

That is 34 of 94. The fraction goes in the README with the denominator next to it, and a test fails the build if the two disagree. Whether all 34 land at a defensible accuracy is a measurement, not a plan; the ones that do not are published with their real numbers and listed in HONESTY.md rather than quietly dropped.

---

## 6. Risks being carried

Stated with the mitigation and the trigger that would force a rethink.

**The calibration numbers may be unflattering.** Marlo's own rules are graded against the same corpus as axe-core and Alfa, both of which have had years of work. Mitigation: none, that is the point. If a Marlo rule is worse than a peer at a rule, the router sends that rule to the peer and the table says so. The trigger for concern is not a bad number, it is a bad number that nobody publishes.

**HTML CodeSniffer has not been pushed since January 2024.** Mitigation: it is a peer, not a dependency of the fix path, and removing it degrades the invariant rather than breaking the build. Trigger: a security advisory, or a browser change that breaks it, at which point it is dropped and the calibration table is regenerated with two peers and a note.

**happy-dom is not a browser.** A rule that passes under happy-dom and fails in Chromium is a false negative Marlo would not see. Mitigation: the capability model refuses to evaluate layout-dependent rules on the static renderer, and CI runs the whole corpus through `BrowserRenderer` as a separate job so any divergence between the two renderers shows up as a diff in the calibration table rather than as a mystery. Trigger: a divergence on a rule that does not declare a layout requirement, which would mean the capability model is wrong.

**Source location in component systems is unsolved.** Mitigation: refuse rather than guess, and make the refusal a first-class output with the reason attached. Trigger: none. This is a limit, not a bug, and it is the first workstream.

**Auto-fix could still cause harm.** A minimal, verified, idempotent diff can still be wrong in a way three engines all miss. Mitigation: Marlo never merges, and the permission boundary is asserted in tests rather than documented in prose. Trigger: the first entry in HONESTY.md.

**The forbidden-claims check can be gamed by wording.** Mitigation: it checks generated output as well as source, and it fails on the phrases the industry actually uses rather than on a general notion of overstatement. It is a floor, not a conscience.

---

## 7. Definition of done for this pass

- `pnpm install && pnpm test` green with no network, no API keys, no browser binary.
- `calibration/table.json` generated from the vendored corpus, with both accuracy views, and a CI job that fails on regression.
- The demo app's violations detected, located, fixed, re-verified, and the resulting diff and PR body committed as golden files.
- Every Marlo-authored surface passing Marlo's own checks at WCAG 2.2 AA with zero critical or serious findings, in CI.
- `trymarlo.pages.dev` resolving, with the accuracy numbers rendered from the table rather than typed into HTML.
- HANDOFF.md, WORKSTREAMS.md, HONESTY.md, and labelled issues detailed enough to be specifications.
