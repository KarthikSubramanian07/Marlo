# Research

Written before any product code, as the build brief required. Everything numeric here was measured on this machine on 2026-07-29, not recalled. Commands are given so you can re-derive them.

Three questions had to be answered before the architecture could be chosen:

1. What is the denominator? If Marlo publishes a coverage fraction, what is below the line, exactly?
2. Which engines are usable, under which licences, and can they run without a browser install?
3. Why did the one project that already tried multi-engine accessibility testing fail, and what does that forbid?

The answers changed the design twice. Both changes are recorded in [DECISIONS.md](DECISIONS.md).

---

## 1. The denominator: the ACT rule corpus

[ACT Rules Format 1.1](https://www.w3.org/TR/act-rules-format/) is a W3C Recommendation. It defines how an accessibility test rule is written down so that two independent implementations can be compared. The rules themselves live in the [ACT-Rules Community](https://act-rules.github.io) corpus, which ships machine-readable test cases alongside every rule. That corpus is the denominator.

Measured from a shallow clone of `act-rules/act-rules.github.io` at `HEAD` on 2026-07-29, and from `https://act-rules.github.io/testcases.json`:

| Quantity                           | Value                            |
| ---------------------------------- | -------------------------------- |
| Published ACT rules                | **94**                           |
| Atomic rules                       | 86                               |
| Composite rules                    | 8                                |
| Rules carrying official test cases | **91**                           |
| Rules with no test cases yet       | 3 (`kb1m8s`, `in6db8`, `2t702h`) |
| Official test cases                | **1134**                         |
| Expected `passed`                  | 448                              |
| Expected `failed`                  | 358                              |
| Expected `inapplicable`            | 328                              |

Re-derive with `pnpm corpus:verify`, which fails if the vendored corpus disagrees with these counts.

So Marlo's coverage fraction has 94 below the line, and the calibration table can only speak about the 91 that have test cases. Both numbers appear in every report Marlo emits. Neither is ever converted to a bare percentage.

### The grading protocol, and the problem with it

This is the most important thing found in the research, and it reshaped the calibration table.

W3C defines how to grade an implementation against a rule's test cases. From `pages/implementations/mapping.md`:

| Example type | Outcomes the protocol allows         |
| ------------ | ------------------------------------ |
| Passed       | `passed`, `cantTell`, `inapplicable` |
| Failed       | `failed`, `cantTell`                 |
| Inapplicable | `inapplicable`, `cantTell`, `passed` |

An implementation returning an allowed outcome on every test case is a **correct implementation**. One that gets every `passed` and `inapplicable` case right but only some `failed` cases is a **partial implementation**.

`cantTell` is allowed everywhere. A tool that returns `cantTell` for all 1134 test cases is, under the official protocol, a correct implementation of all 91 rules.

That is defensible for the purpose W3C had: the protocol grades whether a tool _misleads_, not whether it _helps_, and a tool that says "I do not know" has not misled anyone. It is useless for the purpose Marlo has. A developer wants to know whether a violation will be found and whether a clean report means clean.

**So the calibration table publishes two numbers per rule per engine, side by side:**

- **ACT consistency**, the official verdict: `consistent`, `partial`, or `incorrect`. Comparable to W3C's published implementation reports.
- **Strict precision and recall**, where `cantTell` counts as no detection. This is the number a user experiences.

The gap between the two is the interesting column, and as far as this research found, nobody publishes it. It is the number that could embarrass Marlo, so it goes on the front page. See [`docs/calibration.md`](docs/calibration.md) for the arithmetic and [DECISIONS.md](DECISIONS.md#d-004) for why both are kept rather than one being chosen.

### Licence

The corpus is under the [W3C Software and Document Licence](https://act-rules.github.io/pages/license/), which permits copying, modification, and redistribution provided the notice travels with it and modifications are marked. The corpus is vendored into `corpus/act/` with `corpus/act/NOTICE.md` carrying the full notice, and `scripts/fetch-act-corpus.mjs` regenerates it. Vendoring rather than fetching at test time is deliberate: CI must be green with no network, and a calibration number that silently changes because an upstream file changed is not a calibration number.

---

## 2. The engines

Every candidate was checked for licence compatibility with MIT distribution, maintenance signal, and whether it can run in Node without a browser binary. The last one turned out to matter more than expected. Measured with `gh api repos/OWNER/NAME` and `npm view` on 2026-07-29.

| Engine                                                            | Licence      | npm                               | Stars | Last push                | Verdict                                                                 |
| ----------------------------------------------------------------- | ------------ | --------------------------------- | ----- | ------------------------ | ----------------------------------------------------------------------- |
| [axe-core](https://github.com/dequelabs/axe-core)                 | MPL-2.0      | `axe-core@4.12.1`                 | 7353  | 2026-07-29               | **Adopted.** Peer engine.                                               |
| [Alfa](https://github.com/Siteimprove/alfa)                       | MIT          | `@siteimprove/alfa-rules@0.119.0` | 130   | 2026-07-29               | **Adopted.** Peer engine, and the reference for ACT outcome vocabulary. |
| [HTML CodeSniffer](https://github.com/squizlabs/HTML_CodeSniffer) | BSD-3-Clause | `html_codesniffer@2.5.1`          | 1146  | 2024-01-07               | **Adopted, with a maintenance note.** Peer engine.                      |
| [IBM Equal Access](https://github.com/IBMa/equal-access)          | Apache-2.0   | `accessibility-checker@4.0.29`    | 768   | 2026-07-27               | **Deferred.** Reason below.                                             |
| [QualWeb](https://github.com/qualweb/core)                        | ISC          | `@qualweb/core@0.9.4`             | 12    | 2024-12-30, **archived** | **Deferred.** Reason below.                                             |
| [Nu Html Checker](https://github.com/validator/validator)         | MIT          | `vnu-jar@26.7.25`                 | 1964  | 2026-07-25               | **Deferred.** Reason below.                                             |

All six licences are compatible with shipping Marlo under MIT. MPL-2.0 is file-level copyleft: it obliges anyone modifying axe-core's own files to publish those files, and does not reach Marlo's code. axe-core is consumed as an unmodified npm dependency, so the obligation is not triggered. Recorded in [`docs/licenses.md`](docs/licenses.md) with the reasoning per dependency.

### Adopted: three engines, all running without a browser

The spike that decided the architecture. axe-core and HTML CodeSniffer are browser scripts; Alfa is a Node library that wants a serialised DOM. All three were run against [`happy-dom`](https://github.com/capricorn86/happy-dom) (MIT), a Node DOM implementation, on a fixture with a known set of violations:

```
AXE OK violations: aria-hidden-focus, heading-order, html-has-lang, image-alt,
                   label, landmark-one-main, region
HCS OK count: 41
ALFA total outcomes: 97 { passed: 21, inapplicable: 71, failed: 4, cantTell: 1 }
```

Three independent engines, zero browser binaries, zero network, sub-second. This is what makes the cost constraint survivable, and it is why the default renderer is a Node DOM rather than Chromium. The full consequence, including what this path cannot do, is in [§4](#4-the-rendering-problem).

Alfa needed one non-obvious step. `Native.fromNode` reads `globalThis.document` and calls `createRange`, so the happy-dom window has to be installed as globals before the module is imported, and the result hydrated with `Node.from(json, device)` rather than the more obvious `Document.fromDocument`. That is now `packages/render/src/static.ts` with a comment, because it took four attempts.

Alfa also earns its place for a second reason: its outcome vocabulary is `passed | failed | cantTell | inapplicable`, which is ACT's vocabulary. axe-core has `violations | passes | incomplete | inapplicable`, which maps onto it but not exactly, and HTML CodeSniffer has `Error | Warning | Notice`, which does not map cleanly at all. Those mappings are hand-written, per engine, in `packages/engines/src/*/mapping.ts`, and each one is a documented judgment rather than an inferred equivalence.

### What Alfa does not give you, and why it matters

Alfa rules are identified as `sia-r1` … `sia-r120`, and their metadata carries WCAG success criteria and WCAG techniques. It was checked: **Alfa rule metadata does not carry ACT rule identifiers.** Of 89 exported rules, 76 have non-criterion requirements, and those are `eaa` and `technique` entries, never `act-rule`.

The same is true of axe-core and HTML CodeSniffer. There is no machine-readable engine-rule to ACT-rule mapping shipped by any of them.

**This is the labour that Marlo's contribution actually consists of.** The mapping from each engine's rule identifiers to ACT rule identifiers has to be written by hand, checked against the official test cases, and maintained. W3C's published implementation reports exist because vendors submitted EARL by hand for exactly this reason. It is unglamorous, it is the thing nobody has published as reusable data, and it is why the calibration table is an asset rather than a script.

Consequence for the repository: `packages/engines/src/*/mapping.ts` is the highest-value contribution surface after new rules, and a mapping entry is only accepted with the test case evidence that justifies it. Enforced by review standard in [CONTRIBUTING.md](CONTRIBUTING.md) and by a test that fails when a mapping claims a rule whose test cases contradict it.

### Deferred, with reasons rather than silence

**IBM Equal Access.** `accessibility-checker` drives Puppeteer or Karma and expects to own the browser lifecycle; the underlying `accessibility-checker-engine` is a browser bundle that would fit the happy-dom path. Deferring is about integration shape, not licence or quality. It is [issue](docs/handoff.md) territory, sized in [WORKSTREAMS.md](WORKSTREAMS.md) as a one-engineer task, because a fourth peer engine strengthens the one-directional invariant more than a fourth Marlo rule does.

**QualWeb.** Painful, because `@qualweb/act-rules` is the only engine that implements ACT rules under their own identifiers, which would remove hand-mapping for that engine entirely. It was archived on 2024-12-30. Marlo's whole claim is that its accuracy numbers are current and reproducible; depending on an archived engine for the mapping backbone would put a dead dependency under the load-bearing artifact. Adapter seam left in place, adapter not written. If QualWeb is un-archived this decision should be revisited first.

**Nu Html Checker.** MIT, actively maintained, and the authoritative HTML validator, which matters for the two ACT rules about duplicate attributes and unique `id` values (`e6952f`, `3ea0c8`). It is a Java jar. Adding a JVM to the toolchain for two rules that are decidable directly from the DOM is a bad trade, and both rules are implemented in `@marlo/rules` instead. If a WCAG 4.1.1 parsing rule ever needs real HTML5 parser conformance, this is where to reach.

### Rejected

**Overlay and remediation-widget SDKs.** Not evaluated. Marlo changes source code; an overlay changes what assistive technology is told about unchanged source. See [Product spec §08](README.md#what-marlo-is-not).

**WAVE.** Requires an API key and paid credits per page. Fails the free-at-scale constraint at the first request and cannot have a deterministic offline stub that means anything, because the stub would be the only thing anyone ran.

**ASLint, Editoria11y.** Both in Testaro's ensemble. Deferred purely on effort ordering, not judged. Recorded here so the omission is a decision.

---

## 3. Prior art

### The sibling project: `krishaygarg/ada_pdf_remediation`

MIT, Python, the same problem shape one document format over. It is the epistemological model for this build and the single most useful thing read during this research. What was carried across, and where Marlo differs:

**Carried across.**

_The one-directional invariant._ Its auditor is cross-checked against veraPDF with the rule that if the reference implementation rejects a document, the project's own engine may not call it clean. Marlo's version: **if any peer engine reports a failure for an ACT rule, Marlo may not report clean for that rule.** It may dissent, and the dissent is recorded on the finding with the engine that disagreed. Implemented in `packages/report/src/invariant.ts`, asserted by property test rather than by example, because an invariant tested by three examples is an anecdote.

_The reason it needed the invariant at all._ Its worst defect was a PDF/UA identifier written to `.../pdfuaid/ns/id/` where ISO 14289-1 specifies `.../pdfua/ns/id/`. Every document it had ever produced was unidentifiable to a conforming validator. It survived because **the auditor searched for the same wrong URI the writer emitted, so it confirmed its own defect and reported full compliance.** Two checkers agreed with each other and both were wrong; veraPDF disagreed and was right. An engine audited only by its own authors is not evidence. This is why Marlo has three peer engines rather than a very good one.

_Refusing to generate alt text._ Its position is that a confident wrong description is worse than an absent one, because a reader can detect an absence and cannot detect an error. Marlo adopts this wholesale, with the same narrow exception: describe only where the page itself supplies the meaning (a `figcaption`, a heading, a link target, adjacent text), mark decorative confidently, and refuse the rest with the evidence attached. `packages/repair/src/alt-text.ts`.

_Coverage as a fraction, with a test that prevents drift._ It states 34 of 87 software-determinable conditions out of 136 in the protocol, and has a test asserting the implemented count stays below the determinable count, so the engine cannot quietly start claiming completeness. Marlo's equivalent asserts the implemented rule count against the vendored corpus and fails the build when README and registry disagree. `packages/act/src/coverage.test.ts` and `scripts/check-claims.mjs`.

_A check that crashed must not look like a check that passed._ Its rule engine makes a report non-conformant when a rule throws. Marlo's engine result carries `status: 'ok' | 'error' | 'unsupported'` per rule per engine, and a rule that errored is never counted as a pass anywhere, including in the calibration table, where it is counted as a distinct outcome so the denominator stays honest.

_Truncated output states how much it withheld._ A report listing twelve contrast failures on a page with three hundred implies the page has twelve.

_The interface renders results rather than asserting them._ Its third defect was a web page with a hard-coded scorecard reading one hundred percent and a progress indicator advancing on `setTimeout` while nothing happened; the real audit result came back from the API and was never read. It now has two tests that exist purely because of that: the script must contain no `setTimeout`, and the markup must contain no static tick. **Marlo copies both tests directly**, in `apps/site/test/no-theatre.test.ts`, because Marlo's site shows accuracy numbers and the failure mode is identical.

**Where Marlo differs.**

_Marlo opens pull requests; the sibling writes files._ That is a permission boundary the sibling does not need, so it is designed here from scratch rather than borrowed. See [SECURITY.md](SECURITY.md).

_The sibling has one reference implementation, veraPDF, and it is authoritative._ Marlo has three peers and none of them is authoritative. Cross-checking against a reference is a different problem from cross-checking against disagreeing equals, and it is why Marlo needs a calibration table where the sibling needs only an invariant.

_Verification is cheaper here._ Re-rendering an HTML page and re-scanning it costs milliseconds, so Marlo can afford to verify every fix by re-running the full engine set on the result. That is what makes "verified or flagged, never guessed" enforceable rather than aspirational.

### Testaro and Testilo: the failure to not repeat

[`jrpool/testaro`](https://github.com/jrpool/testaro) (MIT, active, 5 stars) and its predecessor [`cvs-health/testaro`](https://github.com/cvs-health/testaro) (MIT, 53 stars, last push 2025-10-01). Testaro integrated ten rule engines and roughly a thousand rules, was published at ACM SIGACCESS 2023, was adopted inside CVS Health, and reached almost nobody. The work is good. That is what makes it worth studying.

Its own README states the purposes plainly: "provide programmatic access to tests defined by multiple rule engines" and "standardize and integrate the reports of the rule engines". Integration is the product. And it points at the paper that explains why integration alone does not work: [Accessibility Metatesting: Comparing Nine Testing Tools](https://arxiv.org/abs/2304.07591), with [Testaro: Efficient Ensemble Testing for Web Accessibility](https://arxiv.org/abs/2309.10167) describing the tool.

The finding that matters: tools find largely disjoint issue sets with poor inter-rater reliability. Union them and recall goes up while signal-to-noise goes down. Testilo, the companion, had to hand-grade rules and deprecate the ones that were implemented badly, because without that the report was unusable.

Two conclusions, and they are the two load-bearing decisions in this repository.

**More findings is not the value proposition.** A developer with ten engines' output has a triage problem, which is worse than the detection problem they started with. Marlo routes each rule to the engine measured best at it and reports one finding with provenance, rather than reporting four findings that are the same finding.

**The hand-grading was the product all along, and it was never published as data.** Testilo did the work inside itself, to make its own report readable. Marlo's calibration table is that work turned inside out: computed rather than asserted, versioned in the repository, regenerated in CI, and usable by anyone including people who never run Marlo. This is the whole novel contribution and it is a direct consequence of reading why Testaro failed.

A third, smaller conclusion. Testaro's dependency list includes `playwright-extra` and `puppeteer-extra-plugin-stealth`, to make its browser harder to distinguish from a human's. That is an operational cost of scanning sites you do not control. Marlo's primary surfaces scan code the caller owns, before it ships, which removes that problem instead of solving it.

### Existing accessibility MCP servers

Two were read: [`priyankark/a11y-mcp`](https://github.com/priyankark/a11y-mcp) (MPL-2.0, 48 stars) and [`ronantakizawa/a11ymcp`](https://github.com/ronantakizawa/a11ymcp) (MIT, 89 stars).

Both are competent axe-core wrappers over MCP. `a11y-mcp` exposes `audit_webpage` and `get_summary`; its README is candid that the intended workflow is "use the results in an agentic loop with your favorite AI assistants and let them fix a11y issues for you". `a11ymcp` is more thorough, with `test_accessibility`, `test_html_string`, `get_rules`, `check_color_contrast`, `check_aria_attributes`, `check_orientation_lock`.

What they do well, and Marlo should copy: `test_html_string` is the right primitive. An agent mid-generation has a string, not a URL, and a tool that demands a served page forces it to stand up a server to ask a question. Marlo's MCP server takes source directly.

Where the loop is open: both hand findings to the agent and stop. The agent writes a fix based on its own judgment, and **nothing external ever checks the fix.** The model that produced the code grades the correction. That is the exact structure of the sibling project's namespace defect, one layer up.

Marlo's MCP server closes it: `marlo_check` returns findings with provenance, `marlo_repair` returns a diff **plus the re-scan result proving the criterion closed and nothing new broke**, and refusals come back as refusals with evidence rather than as silence. An agent calling `marlo_repair` cannot get a claim of success that was not measured, because the measurement is the return value.

### The LLM accessibility research wave

AXNav, ScreenAudit, GenA11y, Flow-A11y, AccessGuru, and the prompt-level enforcement work across Cursor and Lovable that catalogued invented ARIA behaviours and false compliance claims. Read for failure taxonomy rather than for technique, because they publish incomparable results on incompatible corpora, which is itself the finding.

Two failure modes were designed against directly.

**Fixes drifting into redesign.** Reported repeatedly: asked to fix a contrast violation, a model returns a restyled component. Marlo makes this structurally impossible rather than discouraged. The repair layer's output type is a list of byte-range edits against the original source, and every edit is checked against an allow-list of accessibility-relevant attributes and structural operations before it can be applied. There is no code path in which Marlo emits a rewritten file. `packages/repair/src/edit.ts`.

**False compliance claims.** A fix asserted rather than verified. Marlo's `Fix` type does not have a "claimed" state. A repair is `verified` only when re-render and re-scan across the engine set confirm the target criterion closed and no new violation appeared; everything else is `flagged`, carrying the evidence and any engine disagreement. The type system does not permit reporting a fix that has no verification attached.

The other use for this wave: they need a common harness. Marlo's corpus, grading protocol, and calibration schema work on any implementation that can emit ACT outcomes, including a prompt. Deferred, and recorded as deferred in [HANDOFF.md](HANDOFF.md), because building an evaluation harness for other people's methods before Marlo's own numbers exist would be putting the interesting work before the load-bearing work.

### Locating a rendered violation in source

The hard part, and the place where prior art is thinnest. A violation is found on a DOM node; the fix has to land on the source construct that produced it, which in a component system may be in another file, may be a prop, and may be shared by twenty other nodes.

What was found: source-mapping approaches from the React DevTools lineage, which need a build-time transform; heuristic matching from the codemod lineage; and, in the accessibility tools specifically, almost nothing, because checkers do not need to locate anything.

Marlo's position, stated as a limit rather than a solution: **locate exactly, or flag.** The static renderer path is unambiguous, because the DOM node came from a byte range in an HTML file and the parser records it, which is why HTML is the first-class input. For JSX and templates, `@marlo/repair` locates through the same recorded-offset mechanism when the construct is literal, and refuses when the attribute value is an expression, a spread, or comes from a prop. A refusal is a flag with the source location and the reason. Guessing which prop to change is how a tool ends up editing twenty call sites to fix one.

Component-system location is the largest deferred item in the build and it is the first workstream in [WORKSTREAMS.md](WORKSTREAMS.md).

---

## 4. The rendering problem

The build brief named this as the component that fights the cost constraint, and required real numbers rather than hand-waving.

**The constraint.** Headless Chromium needs roughly 300 MB of memory and hundreds of milliseconds to a second of CPU per page. Cloudflare Workers on the free plan give 128 MB and 10 ms of CPU per invocation. Chromium does not run there and no amount of architecture makes it.

**The measurement that changed the design.** As recorded in [§2](#adopted-three-engines-all-running-without-a-browser), all three adopted engines run against a Node DOM with no browser at all. So the question is not "how do we afford Chromium", it is "which rules actually need it".

They are the rules that need CSS layout, paint order, or script execution: text contrast (`afw4f7`, `09o5cg`), visible focus (`oj04fd`), zoom clipping (`59br37`), orientation lock (`b33eff`), and the keyboard trap family (`80af7b`, `a1b64e`, `ebe86a`). Roughly a dozen of 94. Everything Marlo auto-fixes is decidable from the DOM.

**So the design is a renderer seam with three implementations and an honest capability model.** A `Renderer` declares which capabilities it provides (`dom`, `layout`, `paint`, `script`). A rule declares which it requires. A rule whose requirements are not met by the active renderer returns `status: 'unsupported'`, which is reported as unsupported, never as a pass. This is the sibling project's crashed-check principle applied to a missing capability, and it is the difference between "Marlo found no contrast problems" and "Marlo did not look for contrast problems".

| Renderer                                        | Capabilities                       | Cost                                                                                                                      | Default                      |
| ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `StaticRenderer` (happy-dom)                    | `dom`, `script`                    | Free. In-process, no binary, offline, deterministic.                                                                      | **Yes**                      |
| `BrowserRenderer` (Playwright + Chromium)       | `dom`, `layout`, `paint`, `script` | Free on compute the caller already pays for: their laptop, or their CI. Public-repo GitHub Actions minutes are unmetered. | Opt-in, `--renderer browser` |
| `RemoteRenderer` (Cloudflare Browser Rendering) | `dom`, `layout`, `paint`, `script` | Metered. Seam only, no adapter in this pass.                                                                              | No                           |

**The relocation, stated plainly.** Layout-dependent rules run on compute somebody already pays for. On a developer's machine that is their machine. In CI that is Actions minutes, unmetered for public repositories, which is one of the reasons the repository is public. Marlo's own hosted surface never runs a browser, which is why it has no fixed monthly floor and no egress bill.

**The first dollar.** `RemoteRenderer` against Cloudflare Browser Rendering is the first paid unit, and it is a seam rather than a dependency for exactly that reason. Per-unit numbers, the point at which the free allowance is exhausted, and what degrades when it is, are in [DECISIONS.md](DECISIONS.md#d-007) as the brief required. The account this was built against has the `browser (write)` scope available, so the seam is testable when someone chooses to pay for it.

---

## 5. Candidate ledger

Every candidate considered, in one table, per the brief's requirement. Maintenance signal measured 2026-07-29.

| Candidate             | What it is                       | Licence                   | Signal                          | Used for                                                   | Verdict                                                       |
| --------------------- | -------------------------------- | ------------------------- | ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| ACT-Rules corpus      | 94 rules, 1134 test cases        | W3C Software and Document | Active, pushed 2026-07-29       | The denominator and the calibration ground truth           | **Vendored** into `corpus/act/`, notice included              |
| ACT Rules Format 1.1  | W3C Recommendation, royalty-free | W3C Document              | Recommendation                  | Rule interface shape, outcome vocabulary, grading protocol | **Adopted** as specification                                  |
| axe-core              | Deque's engine                   | MPL-2.0                   | 7353 stars, daily               | Peer engine                                                | **Dependency**, unmodified                                    |
| Alfa                  | Siteimprove's engine             | MIT                       | 130 stars, daily                | Peer engine, ACT outcome vocabulary                        | **Dependency**                                                |
| HTML CodeSniffer      | Squiz's engine                   | BSD-3-Clause              | 1146 stars, quiet since 2024-01 | Peer engine, third opinion                                 | **Dependency**, maintenance risk noted                        |
| happy-dom             | Node DOM implementation          | MIT                       | Active                          | The default renderer                                       | **Dependency**, load-bearing                                  |
| Playwright            | Browser automation               | Apache-2.0                | Active                          | `BrowserRenderer`, screenshots, site E2E                   | **Optional dependency**                                       |
| IBM Equal Access      | IBM's engine                     | Apache-2.0                | 768 stars, active               | Fourth peer engine                                         | **Deferred**, integration shape                               |
| QualWeb               | Lisbon's ACT-native engine       | ISC                       | **Archived 2024-12-30**         | Would remove hand-mapping                                  | **Deferred**, dead dependency risk                            |
| Nu Html Checker       | W3C validator                    | MIT                       | 1964 stars, active              | HTML parse conformance                                     | **Deferred**, JVM cost for two rules                          |
| WAVE API              | WebAIM's hosted engine           | Proprietary               | Active                          | nothing                                                    | **Rejected**, paid per page                                   |
| Testaro / Testilo     | 10-engine ensemble, hand-graded  | MIT                       | Low adoption                    | Read for its failure mode                                  | **Studied, not used**                                         |
| `a11y-mcp`, `a11ymcp` | Single-engine MCP servers        | MPL-2.0 / MIT             | 48 / 89 stars                   | Read for tool surface design                               | **Studied, not used**                                         |
| `ada_pdf_remediation` | Sibling PDF project              | MIT                       | Active                          | Epistemology, invariant, alt-text policy, five tests       | **Studied and cited throughout**                              |
| linkedom              | Lighter Node DOM                 | ISC                       | Active                          | nothing                                                    | **Rejected**, no `getComputedStyle`, which several rules need |
| fast-check            | Property testing                 | MIT                       | Active                          | Codemod property tests                                     | **Dependency**                                                |
| Zod                   | Runtime schema validation        | MIT                       | Active                          | Every trust boundary                                       | **Dependency**                                                |

Full licence ledger with obligations per dependency: [`docs/licenses.md`](docs/licenses.md).

---

## 6. What this research forbids

The findings above rule things out. Writing them down here means a later contributor can see that an absence was a decision.

1. **No unioned findings.** Testaro's failure mode. Route, do not aggregate.
2. **No coverage percentage without a denominator.** 94 is the denominator and it appears next to every fraction.
3. **No single-number accuracy claim.** ACT consistency and strict precision/recall are different numbers measuring different things, and publishing only the flattering one is the behaviour this project exists to argue against.
4. **No self-audit.** The sibling's namespace defect. Marlo's own rules are graded against the same corpus as its peers, in the same table, with no exemption.
5. **No generated alt text where the page does not supply the meaning.** Borrowed, and the reasoning is the borrowed part.
6. **No fix that is not re-verified.** The LLM wave's dominant failure mode, and the reason `Fix` has no `claimed` state.
7. **No rule reported as passing when the renderer could not evaluate it.** Capability model, and the sibling's crashed-check principle.
8. **No dependency on an archived engine for anything load-bearing.** QualWeb, reluctantly.

---

## Sources

Repositories, all inspected at `HEAD` on 2026-07-29:
[`krishaygarg/ada_pdf_remediation`](https://github.com/krishaygarg/ada_pdf_remediation) ·
[`act-rules/act-rules.github.io`](https://github.com/act-rules/act-rules.github.io) ·
[`w3c/wcag-act`](https://github.com/w3c/wcag-act) ·
[`dequelabs/axe-core`](https://github.com/dequelabs/axe-core) ·
[`Siteimprove/alfa`](https://github.com/Siteimprove/alfa) ·
[`squizlabs/HTML_CodeSniffer`](https://github.com/squizlabs/HTML_CodeSniffer) ·
[`IBMa/equal-access`](https://github.com/IBMa/equal-access) ·
[`qualweb/core`](https://github.com/qualweb/core) ·
[`validator/validator`](https://github.com/validator/validator) ·
[`jrpool/testaro`](https://github.com/jrpool/testaro) ·
[`cvs-health/testaro`](https://github.com/cvs-health/testaro) ·
[`jrpool/testilo`](https://github.com/jrpool/testilo) ·
[`priyankark/a11y-mcp`](https://github.com/priyankark/a11y-mcp) ·
[`ronantakizawa/a11ymcp`](https://github.com/ronantakizawa/a11ymcp)

Specifications:
[ACT Rules Format 1.1](https://www.w3.org/TR/act-rules-format/) ·
[WCAG 2.2](https://www.w3.org/TR/WCAG22/) ·
[HTML-AAM](https://www.w3.org/TR/html-aam-1.0/) ·
[ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) ·
[EARL 1.0 Schema](https://www.w3.org/TR/EARL10-Schema/) ·
[SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)

Papers:
[Accessibility Metatesting: Comparing Nine Testing Tools](https://arxiv.org/abs/2304.07591) ·
[Testaro: Efficient Ensemble Testing for Web Accessibility](https://arxiv.org/abs/2309.10167)

Corpus data: [`act-rules.github.io/testcases.json`](https://act-rules.github.io/testcases.json), 1134 cases, retrieved 2026-07-29.
