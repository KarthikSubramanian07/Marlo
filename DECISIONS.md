# Decisions

Architectural decisions with the reasoning and, where one exists, the measurement that settled it. Each entry states what would make it wrong, because a decision record that cannot be falsified is a press release.

Numbering is stable. Superseded entries stay, marked, with a pointer forward.

---

## D-001: The repository is public and MIT

**Status:** accepted.

Marlo's entire claim is that its accuracy is verifiable. An unauditable verifier is a contradiction: "trust our error rate" is the same sentence as "trust our compliance score", which is the sentence this project exists to argue against. The calibration table has to be inspectable, the corpus it was computed from has to be inspectable, and the code that computed it has to be inspectable, or the number means nothing.

Two secondary consequences, both load-bearing rather than incidental. Public repositories get unmetered GitHub Actions minutes, which is what makes it affordable to run three engines across 1134 test cases on every push. And MIT rather than a copyleft licence keeps the engine adapters usable by the tools Marlo wants to be measured against, including the commercial ones, because a calibration harness that competitors cannot legally run is not a shared standard.

**Contributor licensing is DCO, not a CLA.** A CLA is a legal document at the contribution boundary, and the contribution Marlo most wants is a false positive report from someone who is annoyed. Asking that person to sign an agreement first is how the highest-value inbound signal gets lost. `git commit -s` and a required DCO check is the entire mechanism.

**Wrong if:** a contribution turns out to require patent grants that MIT does not provide, which would be a licence problem rather than a policy problem.

---

## D-002: The codemod core is TypeScript, not Rust compiled to WASM

**Status:** accepted. Explicitly considered because the brief invited it.

The contribution funnel for this project is new ACT rule implementations. A rule is a pure function over a DOM. The property that matters more than any other is that someone can add a rule without reading the pipeline.

Rust to WASM would mean a contributor adding a rule needs a Rust toolchain, needs to reason about the WASM boundary, and cannot use the same DOM types as the rest of the codebase. That cost is paid on every contribution, forever, by people whose motivation is that one rule bothers them.

The measurement that settles it: the full pipeline over the demo app, three engines plus re-verification, completes in well under a second in-process. There is no performance problem. Choosing Rust would buy a solution to a problem this project does not have and pay for it in the only currency it cannot afford.

**Onboarding cost of the choice actually made**, since the brief asked: an engineer needs Node 22, `pnpm`, and TypeScript. No native toolchain, no cross-compilation, no `wasm-pack`. `pnpm install && pnpm test` on a clean machine with no network.

**Wrong if:** the corpus grows by an order of magnitude and calibration regeneration stops fitting in CI, or someone wants to run the engine inside a browser extension where bundle size dominates. Both would justify extracting only the edit-application path, which is the one piece with a narrow interface.

---

## D-003: Findings are routed to one engine per rule, not unioned across engines

**Status:** accepted. This is the decision the research forbade the alternative to.

Testaro integrated ten engines and roughly a thousand rules, was published at SIGACCESS, was adopted at CVS Health, and reached almost nobody. The reason is in the ensemble literature it cites: tools find largely disjoint issue sets with poor inter-rater reliability. Union them and recall rises while signal-to-noise falls. A developer handed ten engines' output has a triage problem, which is worse than the detection problem they started with.

So: where several engines implement the same ACT rule, the calibration table says which is measurably best at it and that engine's finding is the one reported. Agreement and disagreement are both recorded on the finding, because both are information. Where only one engine implements a rule, the finding carries that engine's measured accuracy for that rule and nothing more.

**The one-directional invariant limits this.** Routing decides who reports; it does not let Marlo suppress a peer. If any peer engine reports a failure for a rule, Marlo may not report clean for that rule. It may dissent, and the dissent is recorded with the engine that disagreed and the calibration evidence for preferring the router's verdict. Implemented as a property test rather than examples, because an invariant checked by three cases is an anecdote.

**Wrong if:** the calibration data shows that for some rule no engine is reliably better and their errors are uncorrelated, which is the one situation where a union genuinely beats a choice. That would be a per-rule exception with the data attached, not a change of default.

---

## D-004: The calibration table publishes two accuracy views, not one

**Status:** accepted. This is the novel part and it came out of reading the grading protocol properly.

W3C defines how to grade an implementation against a rule's official test cases, in `pages/implementations/mapping.md` of the ACT rules repository:

| Example type | Allowed outcomes                     |
| ------------ | ------------------------------------ |
| Passed       | `passed`, `cantTell`, `inapplicable` |
| Failed       | `failed`, `cantTell`                 |
| Inapplicable | `inapplicable`, `cantTell`, `passed` |

`cantTell` is allowed everywhere. A tool that returns `cantTell` on all 1134 test cases is, under the official protocol, a correct implementation of all 91 rules that have test cases.

That is not a flaw in the protocol. It grades whether a tool _misleads_, and a tool that says "I do not know" has not misled anyone. It is simply not the question a developer is asking, which is whether the violation will be found and whether a clean report means clean.

So the table carries both, per rule per engine, side by side:

- **ACT consistency**: `consistent`, `partial`, or `incorrect`, by the official protocol. Comparable to W3C's published implementation reports.
- **Strict precision and recall**: `cantTell` counted as no detection. What a user experiences.

Publishing only the first would be flattering and standard. Publishing only the second would be incomparable with everyone else's numbers. The gap between them is the column nobody publishes, and it is the number most likely to embarrass Marlo, so it goes on the front page.

**Wrong if:** the strict view turns out to punish a rule for a `cantTell` that is genuinely the correct answer, where the test case is ambiguous rather than the engine being weak. That is a real possibility and the mitigation is that the table reports `cantTell` counts as their own column, so a reader can see whether low strict recall is caution or incapacity.

---

## D-005: The default renderer is a Node DOM, and rules declare the capabilities they need

**Status:** accepted.

Headless Chromium needs roughly 300 MB and hundreds of milliseconds per page. Free Cloudflare Workers give 128 MB and 10 ms of CPU. That gap is not closable by architecture.

The measurement that reframed it: axe-core, Alfa, and HTML CodeSniffer all run against `happy-dom` in Node, with no browser binary, no network, sub-second. So the question is not how to afford Chromium but which rules genuinely need it. They are the ones needing CSS layout, paint order, or interaction: contrast, visible focus, zoom clipping, orientation lock, keyboard traps. Roughly a dozen of 94. Everything Marlo auto-fixes is decidable from the DOM.

A `Renderer` therefore declares capabilities (`dom`, `layout`, `paint`, `script`) and a rule declares requirements. **A rule whose requirements the active renderer does not meet returns `unsupported`, which is reported as unsupported and never as a pass.** This is the sibling project's principle that a check which crashed must not be indistinguishable from a check that found nothing, applied to a missing capability. It is the difference between "Marlo found no contrast problems" and "Marlo did not look".

**Wrong if:** a rule that declares no layout requirement diverges between the two renderers. CI runs the corpus through both and diffs the resulting tables specifically to catch that, and such a divergence means the capability declaration is wrong, not that the renderer is.

---

## D-006: Repairs are byte-range edits against original source, and there is no code path that emits a rewritten file

**Status:** accepted.

The LLM accessibility literature catalogues "fixes drifting into UI redesign" as a dominant failure mode: asked to fix a contrast violation, a model returns a restyled component. Discouraging that in a prompt does not work, because the thing being discouraged is the model's natural output shape.

So the repair layer's output type is a list of `{ start, end, replacement }` against the original bytes, plus the ACT rule each edit serves. Before application every edit is checked against an allow-list of accessibility-relevant attributes and structural operations. Marlo cannot reformat, cannot reorder imports, cannot reflow whitespace, and cannot touch a line it did not need to touch, because there is no function that takes a file and returns a different file.

Three properties follow and are property-tested rather than example-tested:

- **Idempotent.** Applying twice produces one change; re-running on repaired source produces an empty edit list.
- **Deterministic.** Same input, same edits, same order.
- **Minimal.** The union of edited ranges contains no byte that is not part of an accessibility-relevant construct.

**Wrong if:** a legitimate repair needs a change that cannot be expressed as a bounded edit, for instance inserting a skip link that requires a new element plus a target `id` plus a style rule. That case is handled by allowing multiple edits per fix and an explicit structural-insertion operation with its own allow-list entry, and if a repair ever needs more than that it is a flag.

---

## D-007: Cloudflare Browser Rendering is the first dollar, and it is a seam rather than a dependency

**Status:** accepted.

The brief required the first dollar of variable cost identified precisely. Here it is.

Everything Marlo ships costs nothing at any volume, because the compute is either the caller's own machine, unmetered public-repository Actions minutes, or static Pages hosting with no egress charge. One component breaks that: rendering a page in a real browser on infrastructure Marlo pays for, which is what a hosted "scan this URL" service would need.

The candidate is Cloudflare Browser Rendering, and the account this was built against already has the `browser (write)` scope, so the seam is testable by anyone who chooses to pay for it. It is metered by browser time and concurrency, with a free daily allowance and per-unit charges beyond it. **Marlo does not commit those per-unit figures to this document, because Cloudflare's published rates change and a stale price in a decision record is worse than a pointer:** the current rates are at [Browser Rendering pricing](https://developers.cloudflare.com/browser-rendering/platform/pricing/), and `docs/cost-model.md` carries the arithmetic in terms of the rate rather than a hard-coded number, so it stays correct when the rate moves.

What matters architecturally is the shape, and the shape is: `RemoteRenderer` implements the same `Renderer` interface as the other two, is not imported by any default code path, and has no adapter written in this pass. Nothing Marlo currently does requires it. If a hosted scanning surface is ever built, this is the line item, and the graceful degradation is already specified by the capability model: with no remote renderer available, layout-dependent rules report `unsupported` rather than failing the run.

**Wrong if:** someone builds the hosted surface without also building the metering and the cap, at which point the first dollar becomes an unbounded number of dollars. That is why the seam is empty rather than convenient.

---

## D-008: Marlo's own engine is graded in the same table as its peers, with no exemption

**Status:** accepted.

The sibling project's worst defect survived because its auditor searched for the same incorrect URI its writer emitted. It confirmed its own bug and reported full compliance. Two of three checkers agreed and both were wrong.

`@marlo/rules` therefore appears in `calibration/table.json` as one engine among four, measured by the same harness against the same corpus, with the same two accuracy views. `@marlo/rules` does not import `@marlo/engines`, so it cannot see peer results while deciding, and the dependency direction is enforced by a dependency rule rather than by convention.

The uncomfortable consequence is accepted deliberately: where a peer is measurably better at a rule, the router sends that rule to the peer, and the table shows Marlo losing. That is the correct outcome and it is publicly visible.

**Wrong if:** the harness ever grants Marlo's engine a code path the peers do not get, including something as small as a different timeout.

---

## D-009: No generated alt text where the page does not supply the meaning

**Status:** accepted. Borrowed wholesale from the sibling project, and the reasoning is the borrowed part.

A confident wrong description is worse than an absent one, because a reader can detect an absence and cannot detect an error. So:

- Decorative images are marked decorative, confidently, where the evidence supports it.
- A description is written only where the page itself supplies the meaning: a `figcaption`, an adjacent heading, the text of a link the image is the sole content of, or immediately surrounding text.
- Everything else is a flag, carrying the location, the criterion, and what a human needs to decide.

This is a narrower claim than most tools make. It is also the one that survives contact with a screen reader user.

**Wrong if:** nothing currently foreseeable. A model good enough to describe an arbitrary image correctly would still not know whether the description is the one this page needs, which is a context problem rather than a vision problem.

---

## D-010: The site is generated static HTML with no framework, and it reads its numbers from the table

**Status:** accepted.

The sibling project's third defect was a web page asserting a hard-coded one hundred percent in static markup, with a progress indicator advancing on `setTimeout` while nothing happened, and a real audit result that came back from the API and was never read. It now carries two tests that exist only because of that: no `setTimeout` in the script, and no static tick in the markup.

Marlo's site displays accuracy numbers. The failure mode is identical, so both tests are copied directly into `apps/site/test/no-theatre.test.ts`, plus a third: **every number rendered on the site is traced to a field in `calibration/table.json`, and the test fails if a numeral appears in a claim position without a source.** A site about verifiable accuracy that types its accuracy into HTML would be the joke the whole project is about.

No framework because the site is nine pages and a build script, and a client runtime would be more code than the content. Server-rendered by definition, which is also the fastest path to the SEO requirements and to an LCP budget that CI can enforce.

**Wrong if:** the site grows an interactive surface complex enough that hand-written DOM code becomes the larger risk, for instance a live scanner. That would be a Worker with a small client bundle, not a rewrite.

---

## D-011: Pull request remediation is opt-in and off by default, and the safety boundary is enforced in code

**Status:** accepted.

Unsolicited pull requests are how tools get uninstalled. The permission is earned by the accuracy number, not assumed at install time.

The boundary is not a policy, it is a set of assertions. Marlo opens pull requests. It never merges, never pushes to a default branch, never deploys, never force pushes, never rewrites history. Encoded in the token scopes the Action requests, documented scope by scope with the reason each is needed in [SECURITY.md](SECURITY.md), and asserted by tests that fail if a forbidden operation becomes reachable.

**Wrong if:** someone wants an auto-merge mode. The answer is no, and it is a brand decision rather than a technical one: the two permanent rules are that Marlo never sells remediation services and never sells a conformance report to anyone it rates, and merging its own diffs is the same conflict of interest in a smaller box.

---

## D-012: The corpus is vendored, not fetched

**Status:** accepted.

The W3C Software and Document Licence permits it, with the notice travelling along and modifications marked, which `corpus/act/NOTICE.md` and `scripts/fetch-act-corpus.mjs` handle.

Two reasons it is not a convenience. CI has to be green with no network, which the brief required and which is also the only way the offline stub story is true rather than claimed. And a calibration number that silently changes because an upstream file changed is not a calibration number; it is a reading. Regeneration is a deliberate commit with a diff someone reviews, and `pnpm corpus:verify` fails if the vendored corpus does not match its recorded counts.

**Wrong if:** the corpus starts changing often enough that vendoring produces constant churn, at which point pinning to an upstream tag would be better than a copy. It does not currently.

---

## D-013: Commit credit follows Git Author, with a written rewrite policy

**Status:** accepted.

GitHub's contributor graph and commit pages attribute work by the Author name and email on each commit, and by `Co-authored-by:` trailers that use a GitHub-linked address. Pull request openers, issue assignees, and CODEOWNERS lines are not Authors. Treating them as Authors without commits is how credit becomes theatre.

The policy in CONTRIBUTING.md is the operational form: contributor commits keep the contributor as Author; maintainers prefer rebase merges; a substantial rewrite either lands the original commits first or carries a required `Co-authored-by:` for the person whose work was replaced; machine emails and AI co-author trailers are refused by `scripts/check-signoff.mjs`. CREDITS.md is the human-readable roll for people with write access who have not yet committed, so Aarush Chavali, Ishan Garg, and the other collaborators are visible without inventing history.

**Wrong if:** a contributor's measured work routinely lands under a maintainer Author with no trailer and no prior commits of theirs on the branch, or if the check starts accepting `*.local` Author emails again.

---

## Working agreements

Outside the D-series numbering on purpose, because these are not architectural decisions. They are the things the code does not record: approaches already tried and refused, areas that are settled, and what finished means here. The file exists so the same proposal does not arrive twice.

### Already tried and refused

**An inline suppression comment for the forbidden-claims scanner**, and the variant that excludes the checker scripts from scanning. The first is an escape hatch on the whole check, and the first phrase anyone reaches for it with is the one that should not ship. The second leaves the checker's own explanatory comments unscanned, and a comment is where a claim would hide. The pattern data moved into one file instead, and that file is the only exclusion either checker has.

**A `runScripts: false` option on the default renderer.** happy-dom 20 executes inline script under every combination of its flags, all four tested by hand. The option was deleted rather than documented, because an option that lies is worse than no option, and somebody would have relied on it. Reopening this needs a renderer that parses without executing, which is real work rather than a flag.

**Tests that construct impossible inputs to reach defensive branches.** Two such branches were deleted instead. One guarded a routing state the schema now refuses to parse; the other was a second fallback narrowing a value the logic had already narrowed. Prefer making the state unrepresentable.

**An audit check stricter than the criterion it implements.** The harness flagged links inline in a sentence, which WCAG 2.2 success criterion 2.5.8 exempts. Rejected as noise rather than rigour: a check the standard disagrees with produces reports nobody acts on.

**Playwright as a declared dependency.** SETUP.md says a browser is optional and `pnpm check` needs none, and a devDependency would make that sentence untrue for everybody who clones the repository. It is installed inside the two CI jobs that need a real browser, and the lockfile they write is discarded with the runner.

D-002 through D-012 record the other refusals already: a codemod core compiled to WASM, unioning findings across engines, publishing one accuracy view rather than two, generated alt text where the page does not supply the meaning, a framework for the site, and fetching the corpus at test time.

### Settled, and not open for a redesign

The corpus bytes, and the single-path exclusion in the prose and claims checkers.

This project's own engine is graded in the same table as its peers with no exemption, and the table is published while it places third of four. That table is the product, and a table where the author's engine happened to win would be worth nothing. D-008.

Branch protection on `main`. History and required checks have no bypass actor at all, including the repository owner, and that has been tested by attempting a force push and being refused. The review requirement is overridden per merge with `gh pr merge <n> --rebase --admin`, which gets past the review and not past the checks or the force-push rule.

### What finished means here

`pnpm check` green. It is what CI runs, and nothing CI runs sits outside it.

Anything that ships is confirmed in the served artifact rather than in the source that was written, and anything visual is confirmed in a browser at real size.

A fix for a class of defect arrives with a test for the class, not for the one instance that was reported.

No figure is published unless something measured it. A measured figure that is unflattering is publishable. An estimate is not.

When the environment is broken, that is said out loud rather than worked around, and it is never allowed to read as a code failure.

### Working preferences, recorded because they are nowhere in the code

One recommendation rather than a menu. Where alternatives were weighed, name the one chosen and the reason, in a sentence.

Where the official or simplest path is asked for and none exists, say so plainly and say where you looked, rather than offering a workaround as though it were the answer.

Report outcomes as they happened. Failing tests get their output pasted, a skipped step is stated, and nothing is called finished that was not verified.

Quote paths, line numbers and command output rather than describing behaviour from memory.

State an uncertainty in one line and continue on a stated assumption. Stop and ask only where a wrong guess would be unsafe or would waste the work.
