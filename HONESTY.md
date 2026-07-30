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

---

## 10. Three checks that could not fail

Not wrong answers, but checks that would have reported success no matter what.

**The forbidden-claims scanner failed on its own source**, three times, because the word it forbids has to appear in the pattern forbidding it. The tempting fixes were an inline suppression comment, which is an escape hatch on the whole check, and excluding the script, which leaves its explanatory comments unscanned. The pattern data moved to one file, that file is the only thing either scanner skips, and a test asserts the skip list is exactly one path and that the file with its pattern arrays removed is itself clean.

**The corpus verification job called `pnpm` in a CI job with no `pnpm`** and failed with `command not found`. A check that cannot fail for the reason it exists is worse than no check.

**The test suite depended on a prior build**, so `pnpm test` on a clean checkout could not resolve a single workspace package. It passed locally because build output happened to exist.

---

## 11. Standing limitations

Not defects. Things Marlo cannot currently do, written here so their absence is a decision rather than an omission.

**The accessible name computation is incomplete**, and returns a confidence rather than pretending otherwise. Where a name would depend on CSS generated content or the box tree, Marlo answers `cantTell`. That is why its recall on the naming rules sits below its peers', and the calibration table shows exactly what the caution costs.

**Contrast never gets a ratio**, even with a real browser. Computing it correctly needs the effective background behind any transparency, which is a paint-order walk this version does not implement. Marlo locates the text and names the declared colours. Asserting a ratio it has not correctly computed would be a future entry on this page.

**Source locations are not implemented.** Findings carry a DOM selector and state plainly that the source location arrives with the repair layer, rather than reporting a byte offset nobody computed.

**The browser renderer cannot be evaluated by any engine.** It renders and declares `layout` and `paint`, and every adapter needs an in-process DOM window, so nothing can consume it. The static renderer is the only one that produces a report, and the rules needing layout come back as not evaluated rather than as passing. Entry 9 above, and [#37](https://github.com/KarthikSubramanian07/Marlo/issues/37).

**Two of the three engine mappings are unverified.** Only the axe-core mapping was derived by measurement over the corpus. Alfa's and HTML CodeSniffer's are documentation matches, and every entry in both is marked `partial` for that reason, with a test asserting no Alfa entry claims `exact`.

**HTML CodeSniffer's strict recall is zero.** It never returns a definite failure for any rule it claims, because its warnings and notices are advisory and the adapter reads its silence as a pass. That inference is the weakest step in the engines package, it is stated at the top of the adapter, and the calibration table put a number on it.

---

## How to add to this page

If Marlo was wrong about your code, [tell us](https://github.com/KarthikSubramanian07/Marlo/issues/new?template=false-positive.yml). If a confirmed false positive changed a design rather than just a rule, it belongs here, with what reported success at the time.

The bar for an entry is not severity. It is whether something reported success while being wrong. A loud crash is a bug and goes in the changelog. A quiet wrong answer goes here.
