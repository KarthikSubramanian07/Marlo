# Honesty

Every case where Marlo was wrong, or made a claim it could not support. What reported success at the time, and the design change that followed.

This file existed before the product did, which is the point. A project whose claim is "we tell you when we are wrong" needs somewhere to write that down before it has anything to be wrong about. Modelled directly on the sibling project's [`docs/honesty.md`](https://github.com/krishaygarg/ada_pdf_remediation/blob/main/docs/honesty.md), which documents three cases where its own auditor confirmed its own bugs.

The principle, stated once so the rest makes sense:

**Marlo may not be permitted to lie about its own work, and the most dangerous lies are the ones nothing reports.**

Every entry below is a case where nothing errored, nothing warned, and the artifact was wrong anyway.

---

## 1. A security option that did nothing

**What it claimed.** The default renderer shipped with an option to disable script execution, defaulting to off, and a comment about not evaluating untrusted markup in the same process as the repair layer.

**What was true.** The option did not work. happy-dom 20 runs inline scripts written through `document.write` under every combination of `disableJavaScriptEvaluation` and `enableJavaScriptEvaluation`. `DOMParser.parseFromString` runs them too, which the HTML specification says it must not. All four combinations were tested by hand.

**What reported success.** Nothing. The option existed, the type checked, the comment read convincingly, and a reader would have relied on it. It was caught because a test was written to assert the behaviour rather than to assert the option's presence.

**What changed.** The option was removed. An option named `runScripts: false` that runs scripts is worse than no option, because somebody would depend on it. There is now a test asserting the real behaviour, so if happy-dom ever gains a working switch the test fails and someone revisits the documentation, rather than the documentation quietly becoming wrong.

**Standing risk.** The default renderer executes inline page script. Acceptable because Marlo's surfaces scan code the caller already owns, which is going to run in their browser regardless, and because Marlo performs no network fetch so no external script is ever pulled in. The genuinely hostile case is scanning a URL somebody else controls, and Marlo deliberately does not offer that. A parse-only mode is filed as real work rather than faked.

---

## 2. A report file that looked complete and was not

**What it claimed.** `marlo scan --json > report.json` produced a report.

**What was true.** It truncated at exactly 65526 bytes when stdout was a pipe. The file looked like a report, began like a report, and would not parse.

**What reported success.** Everything. Exit code 1, as expected for a page with findings. No warning. No error. 105 KB of measurement reduced to 64 KB of unterminated JSON.

The cause: `process.exit()` immediately after `console.log`. When stdout is a pipe rather than a terminal, `console.log` is asynchronous, and the process died before the write drained.

**What changed.** The CLI sets `process.exitCode` and returns, so Node flushes before exiting. There is a test that pipes the JSON through a subprocess and parses it.

**Why this one is the file's namesake.** It is the exact failure mode this project exists to argue against, occurring inside the project. Nothing lied. Nothing was even wrong, in the sense that every line of logic was correct. The artifact was simply incomplete and looked whole. That is what a Lighthouse score of 100 on an unusable page is.

---

## 3. Thirteen rules crashed, and only a real page found it

**What it claimed.** The HTML CodeSniffer adapter reported results for the rules it maps.

**What was true.** It typed `message.element` as a `string` and passed it to a function calling `.replace()`. HTML CodeSniffer returns the live DOM node. Thirteen rules threw at once the first time the CLI was pointed at a real file.

**What reported success.** Nothing, and that is the architecture working: a crash is `status: 'error'`, which is never a pass anywhere, so it printed as `13 rules threw`. The defect was loud.

But thirteen rules went unmeasured, and the unit tests had not caught it, because none of them exercised that adapter against markup with the shape that triggers it.

**What changed.** `snippetOf` reads the snippet off whatever the engine actually hands over. The end-to-end test now asserts `errored === 0` on the broken demo page, so a crash in any adapter fails the suite rather than being reported politely.

---

## 4. The measurement was wrong before the code was

Two defects in the calibration harness, found by looking at a result that was suspiciously uniform.

### Every engine failed the same rule identically

**What it claimed.** All four engines scored 0.67 precision on ACT rule `b5c3f8` and graded `incorrect`.

**What was true.** Four independent engines failing in exactly the same way is not four coincidences. The rule's two inapplicable examples are `<svg xmlns="...">` and `<math></math>`. `document.write` on an HTML document always produces an `html` root, so both arrived at the engines as an HTML page _containing_ that element, and every engine correctly reported that the page's `html` element had no `lang`.

The finding was right about the document it was given. The document was wrong.

**What reported success.** The harness. It produced a complete, plausible, internally consistent table with a false positive recorded against all four engines for a defect none of them had.

**What changed.** The harness refuses to grade a document the renderer cannot represent, and those cases appear in an `unsupported` column so a reader can see how many test cases each number actually rests on. That is the capability model applied one level up: a measurement that could not be taken honestly is reported as not taken, never as a result.

`consistencyOf` was also changed to exclude unsupported cases while still counting crashes. A crash is a defect in the implementation and the protocol should hold it against it; an unmeasured case is a limit of the environment.

### The fix was worse than the bug

**What it claimed.** The corrected harness measured accuracy over the corpus.

**What was true.** It rejected any document whose root element was not `html`, which skipped **444 of 524 cases**. Every published number rested on a sixth of the corpus.

**What reported success.** The harness again, and more convincingly this time, because the numbers _improved_: Marlo's precision went from 0.71 to 1.00 on several rules. An over-strict filter looks like caution and produces figures that mean nothing.

**What changed.** Only a foreign-namespace root is genuinely unrepresentable; an HTML fragment is fine, because a browser wraps it in `html` and `body` too. Sample size went from 80 back to 447. Both the mistake and the correction are commented at the check itself.

**The lesson recorded here rather than in a comment:** a change that makes your own numbers better deserves more scrutiny than one that makes them worse.

---

## 5. Marlo's own site failed Marlo's own bar

**What it claimed.** The site was built accessible.

**What was true.** The first audit found serious violations on every page: 48 tap targets under 24 by 24 CSS pixels, contrast failures in light mode, and four scrollable regions unreachable by keyboard.

The contrast failures turned out to be two separate things. Some were real: the terminal sample keeps a dark background in light mode, and the error and warning colours had been switched to their light-theme values, so amber sat on near-black at 2.18:1. Others were an artefact of the audit harness itself, which loaded pages over `file://` so that the absolute stylesheet path resolved to the filesystem root and the CSS never applied. axe was measuring the browser's default link colour on white.

**What reported success.** The site tests, all 26 of them, which check structure, landmarks, headings, scroll containers and the viewport declaration, and cannot see contrast at all because contrast needs layout. This is the same limitation Marlo publishes about itself, arriving from the other direction.

**What changed.** The audit serves the site over HTTP and asserts the stylesheet actually loaded before believing any result. Tap targets get a 24 pixel floor. Scrollable regions get `tabindex="0"` and a label. The terminal keeps its dark-theme colours in both schemes.

One finding was rejected rather than fixed: the harness flagged links inline in a sentence, which WCAG 2.2 success criterion 2.5.8 explicitly exempts. The check was stricter than the criterion, which is noise rather than rigour.

---

## 6. The site's own decoration failed the site's own contrast bar

**What it claimed.** The redesign reveals each section as it scrolls into view, fading it in and lifting it a few pixels. No JavaScript, driven by `animation-timeline: view()`.

**What was true.** The audit failed it. axe composites a partial opacity into the effective foreground colour, and it caught body copy at **4.22:1** and an eyebrow at **3.39:1** against the 4.5:1 floor.

axe was right, and the distinction is worth writing down because it is not obvious. A time-based animation finishes on its own in under half a second, so text is briefly faint and then correct. A **scroll-linked** animation has no clock: it sits at whatever progress the reader's scroll position puts it at, and a section straddling the fold can hold 30 percent opacity for as long as the page is left alone. Text at 30 percent opacity is not a transition. It is the contrast of the page.

**What reported success.** The 27 site tests, again. They read the markup and the stylesheet, and neither can see a composited colour, because contrast needs layout. This is the same limitation Marlo publishes about itself, and this is the third time in this file that it has been the thing that let something through.

**What changed.** Two things, in order. First the reveal was made transform-only, which cannot affect contrast at all. That passed, and it also did not read as anything appearing, which was the point of it. Then the animation range was shortened to `entry 0% entry 35%`, so a section is fully opaque well before it is somewhere a reader would stop, and the fade came back. The audit passes with the fade in place, which is the only reason it is there.

**The rule, generalised:** an animation that a reader can pause by not scrolling is a state, not a transition, and every state has to pass on its own.

---

## 7. Four things found by looking at the page at full size

None of these were caught by 27 passing tests, a clean axe run, or a zero-overflow measurement. They were caught by taking a screenshot at 1440 by 900 and one at 390 by 844 and actually reading them. Recorded together because the lesson is the shared one.

**The scoreboard printed "best" next to the engine that detects nothing.** HTML CodeSniffer's false positive rate is 0.0%, so a sort by false positive rate put it first, and the badge generator wrote `best`. Its recall is 0.000: it never returns a definite failure for anything. So the front page of a site whose entire argument is that a tool which says nothing cannot be scored well was scoring it first. An engine now only enters the ranking if it detects something, and that one is labelled `no detections`.

**There was no navigation on a phone.** The nav row was `display: none` below 48em, so four of the five pages were unreachable from a handset. The masthead is a grid now, with one `nav` landmark that becomes a scrolling row. The first attempt shipped two copies of the links and the site test caught it as two landmarks on one page.

**The GitHub glyph filled a button.** The icon SVGs carried a `viewBox` and no `width` or `height`. Inside a full-width button on a phone the glyph expanded to about 350 pixels across with the label shoved into the remaining space. `img, svg { max-width: 100% }` caps the damage at the container and does nothing to prevent it. Icons carry intrinsic dimensions now, and a test measures the largest rendered SVG on every page.

**The browser tab was a different brand from the page.** The stylesheet rendered its accent as one cyan and `favicon.svg` was drawn in another, because an SVG file cannot read a CSS custom property and the two had been written independently. The palette is now recorded once as sRGB hex in `style.css`, `build.mjs` reads from the same list, and a test fails if either asset uses a colour the stylesheet does not record.

None of the four is an accessibility defect except the second. All four shipped, twice, past a green build.

---

## 8. The coverage gate had never run, and failed the first time it did

**What it claimed.** `vitest.config.ts` declared global thresholds of 85 percent statements, lines and functions and 80 percent branches, with `packages/act` and `packages/report/src/invariant.ts` held at 100. CONTRIBUTING.md explained why those were the right numbers. README and ARCHITECTURE both cite the 100.

**What was true.** No CI job invoked it. `pnpm test` runs the unit project without `--coverage`, and `pnpm check` did not call `test:coverage` at all. The first time anything ran it, it failed on four counts: statements at 80.55, branches at 70.04, lines at 81.36, and `invariant.ts` branches at 92.72.

**What reported success.** Every push, for the entire build. And, worse, the documentation: a paragraph explaining why 85 was defensible, next to a figure nothing had measured.

This is the same shape as the corpus job that called `pnpm` in a job with no `pnpm`, and it is a worse instance of it, because that one was loud and this one was silent.

**What changed.** Three things, in this order.

The gaps that were real work got tests. `pull-request.ts` was at **0 percent**: the generated pull request body, one of the two surfaces developers judge Marlo by, had no test at all. It has 16 now, including one that plants a triple backtick in a snippet and asserts the fence around it grows to contain it.

`invariant.ts` went back to 100 on every metric, and two of its uncovered branches turned out not to be missing tests. One guarded a routing entry that named an engine while claiming nobody implements the rule, which is a contradiction; the schema now refuses to parse it and the branch is gone. The other was a second `??` fallback narrowing a value the logic had already narrowed. Both were deleted rather than covered.

Then the global thresholds were set to the measured figures rounded down: 86, 87, 90, and 72 for branches. And a CI job runs them.

**Why branches sit 14 points below statements**, since a reader is entitled to ask. Under `noUncheckedIndexedAccess` every array index produces `T | undefined`, so every `?.` and `??` guarding one is a branch, and a good number are unreachable by construction. The two found here were both of that kind. Writing tests that construct impossible inputs to reach a defensive line would make the number better and the suite worse.

**The rule:** a threshold nothing runs is not a threshold. This repository contains a script whose entire job is to fail the build on claims it cannot support, and it had been shipping one.

---

## 9. A renderer with no engine behind it, and nobody had noticed

**What it claimed.** `BrowserRenderer` declares the capabilities `dom`, `script`, `layout` and `paint`. Two ACT rules report `unsupported` on the default renderer because they need the last two, and the fix documented everywhere, including in the CLI's own output, is to use the browser renderer.

**What was true.** No engine can evaluate a Playwright page. Every adapter runs its engine's script inside the same JavaScript realm as the document, and a Playwright page is a handle to a document in another process. So the browser renderer renders, declares two capabilities truthfully about itself, and nothing downstream can consume it. It is a rendering seam with no adapter behind it.

**What reported success.** Nothing, and this one is genuinely the architecture working. `asWindow` was written for exactly this case and its comment says why: a thrown error rather than a silent null, because an adapter handed the wrong kind of handle would otherwise return a report full of `inapplicable` that reads as a clean page. The peer adapters catch it and report `status: 'error'` per rule, and `error` is never a pass anywhere in this codebase.

**So what was wrong.** The guard had never once been reached. `marlo scan --renderer browser` refuses before it gets there, and no test had ever asked any adapter for a browser page. A guard nothing reaches protects nothing, and the limitation it guards against was in no document: not in HANDOFF, not in the standing limitations below, not on the website. A reader following the advice to use the browser renderer would have found out by trying it.

**Two things it found on the way.**

`MarloEngine` throws synchronously where the peers report an error status. Both are honest and the difference is worth knowing, because a caller that only catches rejections would miss one of them.

**Alfa's adapter had no guard at all.** It reaches `globalThis.document` through `withDomGlobals` rather than taking a window, so a handle it could not read failed several frames deeper with `Cannot read properties of undefined (reading 'createRange')`. Correct in the sense that it failed, useless in the sense that it told a reader nothing. Two of three peers explained themselves and one did not, and nothing had ever compared them because nothing had ever run this path.

**What changed.** Alfa gets the same guard as the other two. `tests/e2e/browser.browser.test.ts` asserts the whole shape: the renderer declares what it declares, resolves a style a Node DOM cannot, and **no engine returns a verdict it could not have earned**. It fails the day somebody makes the browser path work, which is the point of it. The remaining work is [#37](https://github.com/KarthikSubramanian07/Marlo/issues/37): run each engine inside the page rather than beside it.

**The lesson, and it is the one this file keeps relearning:** a check that has never run is not a check, and this is the third instance in this document. The others were a coverage gate no job invoked and a corpus job that called a binary it did not have.

**What is true now.** Every engine runs inside the Playwright page ([#60](https://github.com/KarthikSubramanian07/Marlo/issues/60)). axe-core and HTML CodeSniffer are injected as their own browser scripts, Alfa and Marlo's rules are bundled for the browser at build time, and every verdict crosses back through one serialisation boundary that keeps its selector and snippet. `marlo scan --renderer browser` works, reads its own calibration table, `calibration/browser.json`, so the confidence it prints was measured on the renderer in use, and the browser test is now the golden-file comparison it was always meant to be. The test that asserted no engine could evaluate a browser page failed the day this landed, as it was written to, and was rewritten rather than deleted.

The first run under the browser found something the static path had hidden. That is entry 15.

---

## 10. Three checks that could not fail

Not wrong answers, but checks that would have reported success no matter what.

**The forbidden-claims scanner failed on its own source**, three times, because the word it forbids has to appear in the pattern forbidding it. The tempting fixes were an inline suppression comment, which is an escape hatch on the whole check, and excluding the script, which leaves its explanatory comments unscanned. The pattern data moved to one file, that file is the only thing either scanner skips, and a test asserts the skip list is exactly one path and that the file with its pattern arrays removed is itself clean.

**The corpus verification job called `pnpm` in a CI job with no `pnpm`** and failed with `command not found`. A check that cannot fail for the reason it exists is worse than no check.

**The test suite depended on a prior build**, so `pnpm test` on a clean checkout could not resolve a single workspace package. It passed locally because build output happened to exist.

---

## 11. Two Alfa mappings named the wrong rule

**What it claimed.** `packages/engines/src/alfa/mapping.ts` mapped `sia-r28` to ACT rule 8fc3b6 ("object element has accessible name") and `sia-r33` to bc4a75 ("ARIA required owned elements"), both `partial`, both described in the note as checking the condition their ACT rule names.

**What was true.** Read from the installed rule source rather than from the note: `sia-r28`'s applicability filters on `hasInputType('image')`, so it checks `<input type="image">` accessible names and never inspects `<object>`. `sia-r33`'s applicability is `video(document, device, { audio: { has: false } })`, so it checks silent `<video>` elements for a transcript against WCAG technique G159 and never inspects ARIA required-owned-elements. Neither rule can fire on the corpus it was mapped to, by construction, not by bad luck on this particular sample.

**What reported success.** `partial`, on both, for as long as anyone had been reading the label rather than the number. `Audit.evaluate()` returned `inapplicable` on every one of the corpus's failing examples rather than throwing or omitting the rule, so the calibration table showed a real, if damning, number: strict recall 0.00, not a missing measurement. A `partial` label reads as "catches some of it." Neither rule catches any of it, because neither rule is looking.

**So what was wrong.** The notes described what the ACT rule's title says the check should do, not what the Alfa rule's `evaluate()` function filters on: a documentation match to the wrong document, since neither cited the rule source. It also skewed routing, and worse than simply being absent would have: `sia-r33` never contradicts a passing example, because it never applies to one, so it counted as a safer implementer than axe-core and Marlo's own rule, both of which try on bc4a75 and are sometimes `incorrect`. Silence was outranking an honest attempt. Both entries are removed rather than reclassified ([#43](https://github.com/KarthikSubramanian07/Marlo/issues/43)), `pnpm calibrate --check` now reports bc4a75 as correctly unroutable, and the likely correct targets (59796f for sia-r28, ee13b5 for sia-r33) are left as a lead for whoever measures them next, not claimed here.

---

## 12. HTML CodeSniffer's mapping cited codes that never fired

**What it claimed.** `packages/engines/src/htmlcs/mapping.ts` mapped every HTML CodeSniffer technique code by what its name and its ACT rule's title suggested, unmeasured: two entries as `exact`, one as `superset`, the rest `partial`, with no citation behind any of it.

**What was true.** Running every mapped code over the corpus ([#43](https://github.com/KarthikSubramanian07/Marlo/issues/43)) found four entries that had never once matched their claimed ACT rule, for a structural reason each time, confirmed by reading `html_codesniffer@2.5.1`'s source: `H67.1` checks an unrelated accessible-name conflict (`alt=""` paired with a non-empty `title`), `H24` only fires on `<area>` elements while its ACT rule's corpus is entirely `<object>`, `H91.A.Empty` belongs to a WCAG2AAA-level sniff that this project's WCAG2AA request never reaches, and `H63.1` checks a `scope`-versus-header-id ambiguity, not whether a header cell has any data cell assigned to it at all. A fifth, `H43.HeadersRequired`, cited the wrong subcode in its own technique family; `H43.IncorrectAttr` is the one that actually fires on the ACT rule's failing examples. And the two contrast entries, `G18.Fail` and `G17.Fail`, cannot fire on the static renderer, which never computes a ratio: most of their failing examples (six of eight, eight of ten) get no signal at all and are read as `passed`. Not literally all of them, though: a sweep of every advisory code across the whole 1134-case corpus, looking for one that fires on a failing example and never a passing or inapplicable one, found `G18.Alpha`, which does exactly that on the remaining four, cleanly. Too thin a sample (four cases) to promote out of `cantTell`, so it is documented as a lead in the mapping file rather than acted on, which is also this issue's direct answer to "is there a subset of notices that reliably means failure": barely, and not enough to change the number yet.

**What reported success.** `exact` and `superset` labels with no citation behind them, on entries that, once measured, could not even hold `partial`'s own bar of "catches something." `partial`, unqualified, on the four wrong-target entries, reading as "catches some of it" when the true number was a clean, structural zero. And a first draft of this very entry claimed the contrast codes produced "not even a Warning" anywhere in the corpus, which undercounted in the tidier, more damning direction: the G18.Alpha advisory above was already firing in the numbers behind that draft, just not read closely enough before the note was written. Caught and corrected before this entry's second commit, which is the only reason it reads accurately here.

**So what was wrong.** The table was written from technique names and ACT rule titles, the same failure mode as entry 11's two Alfa rules, at a larger scale: five of seventeen entries named the wrong code entirely (four removed, one corrected to its sibling), because HTML CodeSniffer's technique codes are more numerous and more granular than Alfa's rules. Every remaining entry now cites a measured `f<n>/<n> p<n> i<n>` the same way Alfa's and axe's do, and the two contrast entries are kept specifically because their near-total silence, not quite total, is the finding: this engine hides most of the same uncertainty its peers admit to, and honestly reports a sliver of it.

---

## 13. The front page published a number the harness had stopped agreeing with

**What it claimed.** The first line of README.md: "Our false positive rate is 12.9%. Here is how we measured it, and why we are printing it." A badge repeated it, and a table underneath gave precision, recall and a false positive rate for all four engines.

**What was true.** 6.4 percent. Four rules had gone from refusing the auto-fix gate to clearing it, both peer mappings had been measured for the first time, and a rule had been added. Every one of those moved the published figures. Marlo's precision went from 0.714 to 0.840, Alfa's mapping went from 21 entries to 40, and HTML CodeSniffer stopped being an engine that never returns a definite failure and became the one with the worst false positive rate of the four. The README said none of it.

**What reported success.** Eleven required checks, on every one of those merges.

And the reason is worth stating exactly, because it is not carelessness. `calibration/table.json` is generated by the harness. `calibration/README.md` is generated from it. The website is generated from it too, and `no-theatre.test.ts` traces every numeral on every page back to a field in it, so a hand-written figure cannot reach the site at all. The repository was rigorous about every surface except the one a reader meets first, which was prose, and prose was nobody's output.

`pnpm calibrate --check` did its job perfectly throughout. It compares the committed table to a freshly computed one. It has no opinion about a sentence.

**What changed.** `scripts/check-published-numbers.mjs`, in `pnpm lint`. It recomputes each figure from the table using the same pooling `aggregateStrictAccuracy` uses and compares it to what README.md says: the headline rate, both badges, every cell of the engine table, the sample size, the routing counts, and the exact rule ids in the flattered-by-protocol table.

The part that took the second attempt: a check like this is one reworded sentence away from being decorative. Find each claim with a pattern, compare it, and the day somebody rephrases the line the pattern misses, nothing is compared, and the build is green. So a pattern that fails to match is reported as loudly as a wrong number, and both failure modes were watched before it was wired in.

**Why this one belongs here rather than in the changelog.** Nothing crashed and no artifact was malformed. A reader who came to this repository for the one thing it promises, an accuracy figure it will not flatter, was handed a stale one by the paragraph explaining why it could be trusted. That is the shape this file exists for.

**What is still open.** The site is still published by hand with `pnpm run deploy`, so it can lag main. The script refuses to deploy when the site tests fail and verifies production afterwards, so what is published is checked; when it is published is a person's decision. Publishing from CI would need Cloudflare credentials held as repository secrets, which the project has chosen not to hold.

---

## 14. The calibration gate was described as a CI job, and no CI job ran it

**What it claimed.** README.md listed `pnpm calibrate:check` as "The CI gate: fails on a regression **and** on an unrecorded improvement". SETUP.md called it "what CI runs". Entry 4 and the changelog both lean on it.

**What was true.** No workflow job invoked it. The eleven required checks covered typecheck, lint, format, the corpus digests, unit and end to end tests, coverage, the browser renderer, the site audit, the Action and the sign-off. The one check that compares the published table to what the harness actually computes was run by hand, when somebody remembered.

**What reported success.** Every required check, on every merge, including the merges that regenerated the table.

**What changed.** A twelfth job, "Published numbers match the harness", builds the workspace and runs the check, and it is a required status on main. It now covers both corpora, and the real-page block fails on movement in either direction, because those figures have no better or worse until people have rated the pages.

**The fourth instance** of the lesson in entry 9, and the most uncomfortable one, because this is the gate the whole project's claim rests on.

---

## 15. The invariant held for every rule and not for every element

**What it claimed.** "If any engine reports a failure, Marlo may not report clean." Tested over all 256 combinations of four engines and four outcomes, held at 100 percent coverage, and illustrated in the README by a sample scan in which Marlo's own rule fails a placeholder-only email field, axe-core does not, and the invariant forces the field through with axe-core named as the dissenter.

**What was true.** The invariant was enforced per rule. When the routed engine failed some elements of a rule, the rule was reported, and its findings were taken from the routed engine alone, so an element that a peer failed and the routed engine passed was dropped. On `apps/demo/checkout.html` that was the placeholder-only email field, which is the example the README printed: axe-core is routed for `e086e5`, fails four other fields, passes that one, and the field never appeared in the output. The README's sample described behaviour the scanner did not have.

**What reported success.** The 256-case test, which asserts the property it was written for, about rules. The end to end test "never reports clean where a peer engine reported a failure", which compares rule ids. And the README, which nothing executes.

**How it was found.** The first browser run. In Chromium, axe-core also passes the `input type="tel"` whose `aria-labeledby` is misspelled, and the finding count went from 38 to 37 between the static and browser goldens with every rule still present. A count that falls while every rule-level assertion passes is the shape this file exists for.

**What changed.** `packages/report/src/elements.ts`. Engines locate elements in different notations, so they are matched by the normalised opening tag each carries as evidence. Identical elements are counted rather than collapsed, a failure Alfa locates at an attribute covers the element that carries it, a page-level target is one defect per page, and evidence that identifies no element is never guessed at, so the change can only add findings. Each uncovered element is reported under the peer that failed it, routed as `invariant`, with the engines that disagreed named. The terminal lists those elements first in their rule, because its five-per-rule cap had hidden the recovered email field behind "and 1 more for this rule, not shown". A property test asserts every peer failure is either covered or reported.

**What it found on the way.** Comparing failures element by element surfaced a false positive in Marlo's own `23a2a8`, which applies to HTML `img` elements and HTML elements whose role is `img`. Marlo's rule also took inline `svg` elements, which are SVG elements even inside an HTML page and belong to `7d6734`. The official test cases contain no `svg` with `role="img"`, so the published precision could not show it. The rule was corrected; the ACT figures did not move, and on the real pages Marlo's agreement with Alfa on that rule rose from a kappa of 0.55 to 1.0.

---

## 16. SECURITY.md described two safeguards that did not exist

**What it claimed.** That the Action warns when the target branch has no protection, and that `packages/action/src/boundary.test.ts` asserts the forbidden operations are unreachable.

**What was true.** The Action has never checked branch protection, and there is no `packages/action` directory, so the test it named could not exist. Both sentences were written before the code and survived after it.

**What reported success.** Nothing, because nothing checks a security document against the repository it describes.

**What changed.** Found while adding the opt-in pull request mode to the Action. SECURITY.md now says the Action does not check branch protection, and names the tests that do exist: the scope check is a tested function with its own unit tests, and the pull request planner refuses paths under `.github/`, absolute paths and dot segments, also tested. A security claim nothing can fail is the same defect as an accuracy claim nothing can fail, in a document people read when they are deciding whether to trust the tool.

---

## 17. The front page measured a component, and the routing was graded on its own answers

**What it claimed.** The first line of README.md: "Our false positive rate is 5.6%." A badge repeated it, the site's headline and social image repeated it, and the README argued that Marlo "routes" rather than unioning its engines, with the router choosing the engine "measurably best" at each rule.

**What was true.** 5.6% is the false positive rate of Marlo's own rule engine, one of the four engines inside the product, pooled over the rules it implements. What `marlo scan` reports is a failure whenever any of the four engines fails a rule, because the one-directional invariant forbids silencing a peer. Measured as a whole over the 41 rules the scan evaluates, that output has a false positive rate of 8.7% (95% interval 6.3 to 12.0) on 568 official cases. Nobody had measured the product. Every published number described a part of it.

The routing figure had a second problem. The router chooses each rule's engine from the same per-rule grades the table publishes, and it refuses any engine that flagged a passing case. Scored on those same cases, the routed engine came out at a precision of 1.000, which is partly true by construction. Recomputed leave one out, with each case decided by the engine the router would have chosen without it, precision is 0.933 and recall 0.737: below running Alfa everywhere on both, with overlapping intervals. Holding a single case out changes the router's choice on 16 of 709 cases.

**What reported success.** `check-published-numbers.mjs`, which verified with complete rigour that the headline matched the table's aggregate. It did. The aggregate was the wrong quantity.

**How it was found.** While planning the paper. The routed figure of 1.000 looked too good, and the obvious next question, what the router achieves on cases it did not see, led straight to the question nothing had asked, what the product as a whole achieves.

**What changed.** `calibration/analysis.json` and `ANALYSIS.md`, generated by `pnpm calibrate` from the same harness pass as the table and compared exactly by `--check` in CI. They score every strategy case by case with Wilson intervals: what the scan reports, each engine alone, the routed engine in sample and leave one out, and a majority of engines. The headline, the badge, the site and the social image now state what the scan reports, with the engine figure beside it, and the README checker verifies them against the analysis rather than the aggregate. D-003 now describes routing as what it is, a decision about which finding is reported and with what provenance, and withdraws the claim that it raises accuracy until the rated real pages can test that.

**The lesson.** A number can be checked perfectly and still answer the wrong question. The check that matters is not whether the figure matches its source, but whether its source measures the thing the sentence says.

---

## 18. Standing limitations

Not defects. Things Marlo cannot currently do, written here so their absence is a decision rather than an omission.

**The accessible name computation is incomplete**, and returns a confidence rather than pretending otherwise. Where a name would depend on CSS generated content or the box tree, Marlo answers `cantTell`. That is why its recall on the naming rules sits below its peers', and the calibration table shows exactly what the caution costs.

**Contrast is computed, and declines where a single ratio would be a guess.** With a renderer that provides layout, `afw4f7` and `09o5cg` walk the paint order behind each piece of text: background layers up to the first opaque one, `opacity` multiplied through every ancestor, and the canvas. They answer `cantTell`, naming the element responsible, for a background image or gradient, a blend mode or filter, a text shadow or stroke, a colour syntax they cannot convert exactly, a positioned element painting over the text, or a canvas the page allows to be dark. Every one of their misses on the official cases is one of those declines rather than a wrong ratio. On the static renderer both rules still report as not evaluated, because there is no layout to read.

**Source locations are not implemented.** Findings carry a DOM selector and state plainly that the source location arrives with the repair layer, rather than reporting a byte offset nobody computed.

**The published headline is measured on the static renderer.** It needs no browser, so anybody can reproduce it from a clean clone, and the browser table sits beside it as `calibration/browser.json` rather than replacing it. The browser table records "a dirty tree" in place of a commit, because Playwright has to be added to the workspace manifest for the run and is deliberately not a dependency. Two rules, the meta refresh pair, navigate the page away during evaluation in a real browser, and those cases are recorded as errors rather than graded.

**Real-page ground truth comes from language models, not people.** Every cell of `corpus/real` is resolved, by two models rating independently and a third settling their 40 disagreements, because two independent people were never available and waiting for them left the most important measurement permanently open. Every figure resting on it is labelled model-adjudicated, and the raters are graded on the official cases, whose answers people wrote: the adjudicated labels match on 95.8% of 594. That is a floor on their error on real pages, not an estimate of it, and a human rating of a sample is the test that would confirm or withdraw the real-page figures. What those figures show is not flattering: on real pages what the scan reports has a precision of 0.582 and a recall of 0.570, and Marlo's own engine is the least precise of the four.

**Element identity rests on the evidence engines supply.** Matching failures across engines uses the opening tag in each verdict's markup. Two engines that locate one defect at two different elements, other than the document itself, can still produce two findings, and a verdict whose evidence is not an element is never added, only reported at rule level.

**HTML CodeSniffer cannot compute a contrast ratio on the static renderer**, and unlike Alfa and axe on the identical limitation, it does not consistently report `cantTell` when it cannot: on most failing examples it stays completely silent, and this project's silence-means-passed inference turns that into a reported pass. A narrow advisory code catches a handful of the alpha-transparency shape of the failure honestly, not enough to change the overall picture. See entry 12.

**HTML CodeSniffer's mapping, even fully measured, tops out at `partial`.** Every entry in it now cites a corpus measurement ([#43](https://github.com/KarthikSubramanian07/Marlo/issues/43)), the same as Alfa's and axe's, but not one earned `exact` or `superset`: its checks are WCAG techniques, narrower and more literal than the ACT rules they sit beside, so something is always either missed or over-flagged. That is a property of the engine, not a gap in the measurement.

---

## How to add to this page

If Marlo was wrong about your code, [tell us](https://github.com/KarthikSubramanian07/Marlo/issues/new?template=false-positive.yml). If a confirmed false positive changed a design rather than just a rule, it belongs here, with what reported success at the time.

The bar for an entry is not severity. It is whether something reported success while being wrong. A loud crash is a bug and goes in the changelog. A quiet wrong answer goes here.
