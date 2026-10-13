# Architecture

## How a page moves through

```
                   .-- @marlo/rules ------.
source ---> render -+-- axe-core ---------+--> normalise --> route --> invariant --> report
              |     +-- Alfa -------------+       to ACT       |          |
              |     `-- HTML CodeSniffer -'        ids         |          |
              |                                               |          |
      happy-dom (default)                calibration/table.json   |
      Playwright (opt-in)                calibration/browser.json |
      remote (empty seam)                                    "if any peer failed a rule
                                                              or an element, Marlo may
                                                              not report it clean"
```

Two artifacts are load-bearing. Everything else consumes them.

**`calibration/table.json`.** Per ACT rule, per engine, measured against the 1134 official test cases on the static renderer, plus a separately graded block for the real pages in `corpus/real`. Every confidence score, every routing decision and every number on the website reads from it. A required CI job regenerates it in memory and fails on any movement nobody recorded. `calibration/browser.json` is the same measurement inside Chromium, and `--renderer browser` reads it.

**The verification attached to a fix.** A repair without one is not a fix, it is a flag, and the type system will not let you construct the alternative.

## Packages

Pure logic is separated from I/O by package boundary rather than by convention, and a dependency-cruiser rule enforces it.

| Package            | I/O          | Responsibility                                                                                                             |
| ------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `@marlo/schema`    | none         | Every artifact type and its Zod validator. The vocabulary.                                                                 |
| `@marlo/act`       | none         | The 94 rules as generated data, the W3C grading protocol, accuracy and coverage arithmetic. Every line and branch covered. |
| `@marlo/rules`     | none         | Marlo's own rule implementations, the colour arithmetic and the paint-order walk. One rule, one file, one fixture set.     |
| `@marlo/render`    | DOM, browser | The renderer seam and the capability model.                                                                                |
| `@marlo/engines`   | via render   | Three peer adapters, each able to run in-process or inside a browser page, and the hand-written ACT mappings.              |
| `@marlo/calibrate` | fs           | Runs every engine over both corpora, on either renderer, and produces the tables.                                          |
| `@marlo/report`    | none         | The invariant per rule and per element, the terminal surface, SARIF, the pull request body.                                |
| `@marlo/repair`    | GitHub REST  | Source location, minimal verified diffs, the pull request planner, and the GitHub client the Action uses.                  |
| `@marlo/cli`       | everything   | `marlo scan`, `fix`, `explain`, `coverage`.                                                                                |
| `@marlo/mcp`       | stdio        | Three read-only tools over MCP. No tool that writes.                                                                       |
| `apps/site`        | Cloudflare   | trymarlo.pages.dev, generated from the table.                                                                              |

## The three rules that shape everything

### A rule declares what it needs; a renderer declares what it has

A renderer publishes capabilities (`dom`, `script`, `layout`, `paint`). A rule publishes requirements. **A rule whose requirements are unmet reports `unsupported`, never a pass.**

That is the difference between "no contrast problems were found" and "contrast was not examined", and it is what lets the default path run with no browser without quietly claiming coverage it does not have.

Enforced structurally rather than by review: `rules.test.ts` runs every rule twice, with resolved styles present and absent, and fails if any rule not declaring `layout` changes its verdict.

### Marlo's engine cannot see its peers

`@marlo/rules` may not import `@marlo/engines`. The sibling project's worst defect survived because its auditor searched for the same wrong URI its writer emitted, confirming its own bug and reporting success.

The cost is a small duplication: `@marlo/rules` assembles an `EngineReport` and so does `@marlo/engines`. That duplication _is_ the enforcement, and it is cheaper than the alternative. `MarloEngine` in `@marlo/calibrate` is the wrapper that lets the harness treat Marlo like any other engine, and a test strips its comments and asserts the code contains no verdict logic.

### Routing decides who speaks, not who may be silenced

The table names one engine per rule. But if **any** engine reports a failure, Marlo may not report clean. It may dissent, on the record, with the disagreeing engine named and the calibration evidence attached. Tested over all 256 combinations of four engines and four outcomes.

The same holds per element. When the routed engine fails some elements of a rule and passes one a peer failed, that element is reported under the peer, because engines locate elements in different notations and are matched by the opening tag each carries as evidence. Identical elements are counted rather than collapsed, and evidence that identifies no element is never guessed at, so this can only add findings. `packages/report/src/elements.ts`, with property tests.

### The browser path runs every engine inside the page

A Playwright page is a handle to a document in another process, and every engine is built to run in the same realm as the document. So the browser path injects axe-core and HTML CodeSniffer as their own scripts and loads build-time bundles of Alfa and of Marlo's rules, runs them with `page.evaluate`, and brings every verdict back through one structured-cloneable shape in `packages/engines/src/engine.ts` that keeps its selector and snippet. Marlo's bundle reads real computed styles and boxes, which is what the contrast rules need.

## Adding a rule

One file under `packages/rules/src/rules/`, one line in `registry.ts`, one fixture set. A rule is a pure function over the structural interfaces in `dom.ts`, so it runs against a hand-built fixture with no renderer anywhere.

`defineRule` validates at load time: a rule naming an ACT id the corpus does not contain, or declaring success criteria that disagree with what ACT publishes, is a startup failure rather than a wrong row in the table.

See [CONTRIBUTING.md](CONTRIBUTING.md#add-an-act-rule).

## Where the compute lives, and what it costs

|                          | Runs on                          | Cost at any scale                                                             |
| ------------------------ | -------------------------------- | ----------------------------------------------------------------------------- |
| CLI, library             | The caller's machine             | Zero                                                                          |
| Engines, static renderer | In-process, no binary            | Zero                                                                          |
| Calibration              | GitHub Actions, public repo      | Zero, unmetered                                                               |
| Browser renderer         | The caller's machine or their CI | Zero, unmetered on public repos                                               |
| Site                     | Cloudflare Pages, static         | Zero, no egress charge                                                        |
| `RemoteRenderer`         | Cloudflare Browser Rendering     | **The first dollar.** Deliberately unimplemented. [D-007](DECISIONS.md#d-007) |

No fixed monthly floor. The only component with a per-unit cost is the one that throws when you call it, and it explains why in its own source.
