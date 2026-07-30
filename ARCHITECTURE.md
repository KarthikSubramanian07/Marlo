# Architecture

## How a page moves through

```
                   .-- @marlo/rules ------.
source ---> render -+-- axe-core ---------+--> normalise --> route --> invariant --> report
              |     +-- Alfa -------------+       to ACT       |          |
              |     `-- HTML CodeSniffer -'        ids         |          |
              |                                               |          |
      happy-dom (default)                          calibration/table.json |
      Playwright (opt-in)                                                 |
      remote (empty seam)                                    "if any peer failed,
                                                              may not report clean"
```

Two artifacts are load-bearing. Everything else consumes them.

**`calibration/table.json`.** Per ACT rule, per engine, measured against the 1134 official test cases. Every confidence score, every routing decision and every number on the website reads from it. Regenerated in CI; a regression fails the build.

**The verification attached to a fix.** A repair without one is not a fix, it is a flag, and the type system will not let you construct the alternative.

## Packages

Pure logic is separated from I/O by package boundary rather than by convention, and a dependency-cruiser rule enforces it.

| Package            | I/O          | Responsibility                                                                                                             |
| ------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `@marlo/schema`    | none         | Every artifact type and its Zod validator. The vocabulary.                                                                 |
| `@marlo/act`       | none         | The 94 rules as generated data, the W3C grading protocol, accuracy and coverage arithmetic. Every line and branch covered. |
| `@marlo/rules`     | none         | Marlo's own 35 rule implementations. One rule, one file, one fixture set.                                                  |
| `@marlo/render`    | DOM, browser | The renderer seam and the capability model.                                                                                |
| `@marlo/engines`   | via render   | Three peer adapters, and the hand-written engine-rule to ACT-rule mappings.                                                |
| `@marlo/calibrate` | fs           | Runs every engine over the corpus and produces the table.                                                                  |
| `@marlo/report`    | none         | The invariant, the terminal surface, SARIF, the pull request body.                                                         |
| `@marlo/cli`       | everything   | `marlo scan`, `explain`, `coverage`.                                                                                       |
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
