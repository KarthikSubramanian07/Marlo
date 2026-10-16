# Changelog

Notable changes to Marlo. Kept to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioned with [semantic versioning](https://semver.org/spec/v2.0.0.html).

Two additions to the usual sections, because two kinds of change matter here more than a feature does:

**Accuracy** records every movement in a published number, with the direction stated plainly. A number getting worse is a changelog entry, not a silence.

**Coverage** records rules added or removed, always as a fraction with its denominator.

Nothing is published to a registry yet. There is no installable release, so there is nothing yet that could be depended on.

## [Unreleased]

### Added

- Every engine now runs inside a real browser page ([#60](https://github.com/KarthikSubramanian07/Marlo/issues/60), [#37](https://github.com/KarthikSubramanian07/Marlo/issues/37)). axe-core and HTML CodeSniffer are injected as their own scripts, Alfa and Marlo's rules are bundled for the browser at build time, and every verdict crosses back through one serialisation boundary that keeps its selector and snippet. `marlo scan --renderer browser` works and reads its own table, `calibration/browser.json`. The browser path has committed golden output.
- Contrast is computed ([#61](https://github.com/KarthikSubramanian07/Marlo/issues/61)). `afw4f7` and `09o5cg` walk the paint order behind each piece of text, compositing alpha and ancestor opacity in sRGB, and answer `cantTell` naming the responsible element wherever a single ratio would be a guess: background images and gradients, blend modes and filters, text shadows, positioned elements painting over the text, colour syntaxes they cannot convert exactly, and canvases a page allows to be dark.
- A second corpus of 25 real pages ([#62](https://github.com/KarthikSubramanian07/Marlo/issues/62)), vendored and digest-verified like the first, with a two-rater adjudication protocol, tooling that computes Cohen's kappa and logs every disagreement, and empty worksheets. The harness measures every engine on it in a separate pass and writes an optional `realCorpus` block that is never pooled with the ACT figures and refuses an accuracy figure before any cell is rated.
- Repair that opens a pull request ([#63](https://github.com/KarthikSubramanian07/Marlo/issues/63)). `marlo fix --json`, a pure planner whose branch name is derived from the edits so a second run opens nothing, a GitHub client that refuses to write to the default branch or force-update a ref, and an opt-in `open-pull-request` mode in the Action that requires exactly `contents: write` and `pull-requests: write`. The body carries the measurement and the three verification answers per fix, and the disqualifying number per refusal.
- The one-directional invariant per element. A peer's failure on an element the routed engine passed is reported, attributed to the peer and marked as an invariant, and the terminal lists those elements first in their rule.
- A required CI job runs `pnpm calibrate --check`.
- `calibration/analysis.json` and `ANALYSIS.md`: what `marlo scan` reports measured as a whole, every engine alone, the routed engine in sample and leave one out, a majority of engines, Wilson intervals on every proportion, pairwise agreement between engines, the flattered column's sensitivity to its threshold, and the routing scored on rated real pages once any exist.
- `node scripts/rate.mjs --rater A` (or `B`), a local interface for rating the real pages.
- Ground truth for all 1025 real-page cells, rated independently by two language models blind to every engine, with the 40 disagreements settled by a third (D-014). Every sheet, resolution and published figure names the kind of rater and the model, and the schema refuses a rated cell without them. `scripts/rater-validity.mjs` grades the same raters on the 594 official test cases of the same rules with their names hidden, and writes `corpus/real/adjudication/RATER-VALIDITY.md`.
- Addresses that refuse a plain request now work. Sites such as the W3C's inaccessible demo and Hacker News refuse every request from Cloudflare's Workers; for those, and for pages that build themselves with JavaScript, the site's Worker asks `marlo-fetcher`, a new Worker with no public address, to load the page in Cloudflare Browser Run. The playground says when a page came through a browser, and the deploy script ships the fetcher before the site (D-015).
- The playground takes a web address or a GitHub repository as well as pasted HTML (D-015). A web address is fetched once by the site's Worker, which returns that page's HTML under strict limits and stores nothing; a repository's HTML files, up to twenty-five, are read straight from GitHub, with a per-file list of failures. The preview loads the checked page's own styles so the layout rules see it as designed, and warns when a page builds itself with JavaScript.
- "Try it" is a filled button in the masthead on every page, and the home page's first button. A few handwritten margin notes, in Caveat, mark up the site in Marlo's own voice.
- A playground at [trymarlo.pages.dev/try](https://trymarlo.pages.dev/try/). Paste HTML and Marlo's own rules check it in your browser, inside a sandboxed frame where its scripts never run, with each rule's measured precision beside every finding and the report downloadable as JSON. The page's policy forbids any request, so nothing pasted leaves the browser. The rules are bundled from source at site build time.
- A bookmarklet on the same page that runs those rules on any page the visitor opens and lists the failures in a panel, outlining an element when it is chosen.
- A container image, `ghcr.io/karthiksubramanian07/marlo`, for amd64 and arm64: the CLI with nothing to install but Docker. A workflow builds it on every pull request that touches it, checks that the broken demo fails and the clean one passes, and publishes from `main`.
- `calibration/ERROR-ANALYSIS.md`, which names a root cause for each of the 70 real-page cells Marlo's own engine gets wrong, with what it said and what both raters said, and reruns the engine in headless Chromium to separate renderer errors from rule errors. `scripts/error-analysis.mjs --check` runs in CI and fails if the stored verdicts stop reproducing the calibration table or a wrong cell has no cause.

### Accuracy

- First accuracy figures on real pages, model-adjudicated. What `marlo scan` reports: precision 0.582, recall 0.570, false positive rate 4.1%, against 0.831, 0.853 and 8.7% on the official cases. Marlo's own engine: precision 0.372, recall 0.172. The routing chosen on the official corpus, scored on these pages: precision 0.528, recall 0.204, below Alfa alone at 0.737 and 0.452.

### Fixed

- The invariant held for every rule and not for every element, so a field a peer failed could vanish when the routed engine failed other fields of the same rule. On the checkout demo that was the placeholder-only email input the README's sample output described. HONESTY.md entry 15.
- On a page with shadow roots, Marlo's element rules answered as though the shadow content were absent, because its document view does not enter shadow trees. A failing contrast example whose only text is in a shadow root came back `inapplicable`, which the ACT protocol does not allow. Those rules now add a `cantTell` naming how many shadow roots went unexamined, and rules about the document itself are unaffected. In the browser table, `afw4f7` and `09o5cg` move from `partial` to `consistent` as a result, with no precision or recall changing.
- `23a2a8` no longer reports inline `svg` images, which belong to `7d6734`. The official cases contain no `svg` with `role="img"`, so the published precision could not show it.
- README.md and SETUP.md described `pnpm calibrate:check` as a CI gate that no job ran. HONESTY.md entry 14.
- SECURITY.md described a branch protection warning and a test file that did not exist. HONESTY.md entry 16.
- The required-check count had drifted across AGENTS.md, CONTRIBUTING.md and SETUP.md. It is now in the AGENTS.md table of constants that live in more than one place.

- Links to trymarlo.pages.dev now preview on LinkedIn, Facebook and Slack. The social image was an SVG, which those crawlers do not render, so LinkedIn reported that it could not preview the page. The build now rasterises the same SVG to a 1200 by 630 `og.png` and declares its type, size and alt text.

### Changed

- Credit and authorship are written down: CONTRIBUTING.md, CREDITS.md, D-013, and the DCO check now also refuse machine Author emails and AI co-author trailers. Collaborators with write access who have no commits yet (including Aarush Chavali and Ishan Garg) are listed in CREDITS.md without inventing Git Authors.

### Accuracy

**The headline now states what `marlo scan` reports: a false positive rate of 8.7%, not 5.6%.** Nothing got worse; the old figure measured a different thing. 5.6% is Marlo's own rule engine, one of four engines in the product. The product reports a failure whenever any engine does, and measured as a whole over the 41 rules it evaluates, its output has precision 0.831, recall 0.853 and a false positive rate of 8.7% (95% interval 6.3 to 12.0). HONESTY.md entry 17.

**The routed engine's precision of 1.000 was in sample.** Recomputed leave one out, it is 0.933 with recall 0.737, below Alfa alone on both, with overlapping intervals, and holding one case out changes the router's choice on 16 of 709 cases. `calibration/analysis.json` publishes these and the other case-by-case figures with Wilson intervals, and `--check` compares them exactly.

**The published static figures did not move.** Precision 0.853, recall 0.640 and a false positive rate of 5.6% over 513 graded cases, exactly as before. Contrast needs layout, so the static renderer still reports both contrast rules as not evaluated, and the `23a2a8` correction touches no official case.

**axe-core 4.14.0 and happy-dom 20.14.6 moved no accuracy figure** on either renderer. On the real pages axe-core 4.14.0 finishes the React documentation page that 4.13.0 errored on, so it covers 25 pages rather than 24.

**The browser table is published for the first time**, in `calibration/browser.json` and [calibration/BROWSER.md](calibration/BROWSER.md), beside the headline rather than replacing it. 590 cases are graded there against 513 on the static renderer, because the layout cases become measurable.

**The real-page block carries no accuracy figure**, because nobody has rated the pages yet. What it does carry moved once in this round: the `23a2a8` correction took Marlo's agreement with Alfa on that rule from a kappa of 0.55 to 1.0 and with axe-core from 0.50 to 0.67.

Five rules added under [#38](https://github.com/KarthikSubramanian07/Marlo/issues/38) moved the pooled figures. No entry that was already in the table changed: every one measures exactly what it did before.

| Figure                    | Was   | Now   |
| ------------------------- | ----- | ----- |
| Marlo strict precision    | 0.840 | 0.853 |
| Marlo strict recall       | 0.633 | 0.640 |
| Marlo false positive rate | 6.4%  | 5.6%  |
| Official test cases       | 456   | 513   |

**The false positive rate fell without any existing rule getting more accurate.** The five rules add 57 graded cases: 10 true positives, 4 misses, 43 true negatives and no false positives. More correct negatives in the denominator lower the rate while the 19 false positives already recorded stay where they were. It is more measurement, not a better engine.

| Rule     | Strict precision | Strict recall | TP  | FP  | FN  | cantTell (fail/pass) | Routed to                |
| -------- | ---------------- | ------------- | --- | --- | --- | -------------------- | ------------------------ |
| `b40fd1` | 1.00             | 1.00          | 3   | 0   | 0   | 0/0                  | Marlo, previously nobody |
| `047fe0` | 1.00             | 0.75          | 3   | 0   | 1   | 0/0                  | Marlo                    |
| `ye5d6e` | 1.00             | 0.33          | 1   | 0   | 2   | 2/7                  | Marlo                    |
| `2ee8b8` | 1.00             | 1.00          | 3   | 0   | 0   | 0/2                  | Marlo                    |
| `cf77f2` | not measured     | 0.00          | 0   | 0   | 1   | 1/8                  | Marlo, uncalibrated      |

`b40fd1` was the one claimed rule no engine reported. axe-core maps it and fails a passing example, which rules it out of routing, so a page that opened with navigation and put its content in no landmark came back clean. It now routes to Marlo.

The misses are chosen. `047fe0` passes a heading moved off-screen by a stylesheet class, because the rule declares only `dom`. `ye5d6e` answers `cantTell` on a page opening with a single link and on a skip link that lands in an `aside`, because one page cannot show whether either repeats elsewhere. `cf77f2` fails only where nothing on the page could collapse a block, because Marlo does not implement `3e12e1`, and its one failing example has an `aside` it cannot place. `ye5d6e` and `cf77f2` both grade `consistent` with strict recall under 0.5, so the flattered column now has nine entries, five of them Marlo's.

Three movements before that, since the first published measurement, all from work under Phase 1.

| Figure                    | Was   | Now   |
| ------------------------- | ----- | ----- |
| Marlo strict precision    | 0.714 | 0.840 |
| Marlo strict recall       | 0.621 | 0.633 |
| Marlo false positive rate | 12.9% | 6.4%  |

Precision and the false positive rate moved on the four text-spacing and ARIA rules the auto-fix gate had been refusing: `4e8ab6` from 0.00 to 1.00, `24afc2` and `9e45ec` from 0.29 to 1.00, `78fd32` from 0.33 to 1.00. `78fd32` now clears the gate and runs its codemod.

**Recall moved twice and the second time it moved down.** Measuring the Alfa mapping over the whole corpus took it up, and implementing `36b590` took it from 0.654 back to 0.633. That rule answers `cantTell` on all five of its failing examples by design, because deciding whether an error message describes a cause is a question about language, and the strict view counts a `cantTell` on a failing example as a miss. It is the correct reading: a developer whose page ships broken did not receive partial credit. The entry grades `consistent` under the official protocol while missing every violation, so it appears in the `flatteredByProtocol` column, which is what that column is for.

`36b590` records zero false positives and zero disallowed outcomes over its nine test cases.

### Added

- The research gate: `RESEARCH.md`, `PLAN.md`, `DECISIONS.md`, and the third-party licence ledger.
- Repository foundation: pnpm workspace, TypeScript in strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, ESLint, Prettier, dependency-cruiser rules that assert the architecture, pre-commit hooks that mirror CI.
- The forbidden-claims check. Nine phrases Marlo is not entitled to say, each with the reason it is refused, listed in `scripts/lib/rule-data.mjs`. Fails the build if any appears anywhere in the repository, including in generated output. There is no suppression comment.
- The prose check. No em dashes, no AI slop vocabulary.
- DCO sign-off enforcement, locally in a commit hook and in CI as a required status.
- Issue templates that route: false positive, false negative, new rule, calibration dispute, WCAG interpretation, bug. The false positive path is the shortest one in the repository, on purpose.
- Label taxonomy as committed configuration in `.github/labels.yml`, applied by `scripts/sync-labels.mjs`.

- The ACT-Rules Community corpus vendored into `corpus/act/`: 1134 official test cases across 91 rules, under the W3C Software and Document Licence with the notice and a SHA-256 manifest. `pnpm corpus:verify` fails on a modified byte, on an unlisted file, and on a drift in the documented totals.

- `@marlo/schema`, `@marlo/act`, `@marlo/render`, `@marlo/engines`, `@marlo/rules`, `@marlo/calibrate`.
- The calibration table, `calibration/table.json`, generated by `pnpm calibrate` and regression-gated by `pnpm calibrate:check`.

- `@marlo/report`: the one-directional invariant, tested over all 256 combinations of four engines and four outcomes; the terminal surface, where severity is a text mark and never colour alone; SARIF 2.1.0 with per-engine provenance; the pull request body.
- `@marlo/cli`: `marlo scan`, `marlo explain`, `marlo coverage`. `marlo fix` exits with an error stating the repair layer is not merged, rather than being a flag that does nothing. The CLI refuses to merge, push, deploy or force push, and a test asserts each refusal.
- The website at [trymarlo.pages.dev](https://trymarlo.pages.dev), five pages generated from `calibration/table.json` by `apps/site/src/build.mjs`. Every numeral on the site goes through one function that requires a field name in the table, so a hand-typed figure cannot reach a page. No client-side script at all.
- `pnpm screenshots`: the dogfood gate. Serves the built site over HTTP, captures it at 390, 834 and 1440 CSS pixels in both colour schemes, and runs axe-core, a tap target check and a horizontal overflow measurement against every page. Currently zero critical or serious violations, zero overflow.
- `HONESTY.md`, `ARCHITECTURE.md`, `SETUP.md`, `HANDOFF.md`, `WORKSTREAMS.md`.
- `@marlo/repair`: source location backed by parse5 with per-attribute byte ranges, mechanical codemods for seven rules, and the verification loop. `marlo fix` and `marlo fix --write`.
- Six property-based tests over the codemod layer. One of them found a real defect before any of this shipped: renaming one of two identical invalid ARIA attributes unmasked the second copy, turning one violation into a different one and breaking idempotence. No codemod now edits an attribute that is written more than once, because the parser only shows it one of them.
- `@marlo/mcp`: Marlo over the Model Context Protocol, three read-only tools, JSON-RPC over stdio. There is no `fix` tool and there will not be one: a tool call has no human between the decision and the edit, so repair arrives as a pull request somebody approves. Asking for a write tool returns the reason rather than a not-found, and a test asserts the package does not import `writeFileSync` or `execSync` at all.
- The GitHub Action, at `.github/actions/marlo`. Its first step refuses a token with `contents: write` and stops, because inside an Action "Marlo never pushes" is a statement about a permission rather than about the code. Where the runner does not expose the permission set, the step says the scopes were **not** checked rather than reporting a pass it did not earn.
- `apps/demo/clean.html`: a page with nothing wrong with it. A scanner only ever pointed at broken markup has never been tested for a false positive. CI runs the Action against both, and the clean one has to pass while still reporting the two rules it could not evaluate.
- `apps/demo`: two deliberately broken pages, with every defect annotated by the ACT rule it trips and `apps/demo/expected.json` naming the rules that must fire, the rules that must report as not evaluated, and three defects Marlo cannot detect with the reason for each.
- `pnpm test:e2e`: the whole pipeline against real files, with committed golden output for the terminal surface, SARIF and the JSON report. Asserts 31 of 35 rules fire, zero crashes, no peer failure swallowed, and that `--json` through a pipe parses.
- Vendored DM Sans and JetBrains Mono, latin subset, 68 KB for the pair, so the site's content security policy keeps `font-src` at `'self'`.

### Accuracy

First published measurement, over 447 official ACT test cases on the static renderer.

| Engine           | Strict precision | Strict recall | False positive rate |
| ---------------- | ---------------- | ------------- | ------------------- |
| Alfa             | 0.969            | 0.839         | 1.6%                |
| axe-core         | 0.952            | 0.777         | 2.0%                |
| **Marlo**        | **0.714**        | **0.621**     | **12.9%**           |
| HTML CodeSniffer | not measured     | 0.000         | 0.0%                |

Marlo is the least accurate of the three engines that produce verdicts. Routing sends 22 rules to axe-core, 12 to Marlo, 3 to Alfa, and 4 to nobody. Auto-fix is permitted on 6 of 41 routed rules.

HTML CodeSniffer's strict recall is zero: it never returns `failed` for any rule it claims, because its `Warning` and `Notice` types both map to `cantTell` and the adapter reads silence as a pass. See [HONESTY.md](HONESTY.md).

Three entries are officially `consistent` under W3C's protocol while missing more than half the violations, two of them Marlo's own (`5c01ea`, `c487ae`) and one axe-core's (`3ea0c8`). That gap is the reason the table has two halves.

- `tests/e2e/browser.browser.test.ts` and a CI job for it. The browser renderer renders and declares `layout` and `paint`, and no engine can evaluate a Playwright page, so nothing downstream can consume it. The test asserts no engine returns a verdict it could not have earned, and it fails the day somebody makes that path work. See [HONESTY.md](HONESTY.md#9-a-renderer-with-no-engine-behind-it-and-nobody-had-noticed).

### Coverage

- Denominator established: **94 published ACT rules**, 91 of which carry official test cases.
- Marlo implements **41 of 94**, up from 36 of 94. All 41 can be calibrated.
- Added `b40fd1`, `047fe0` and `ye5d6e`, the three atomic bypass blocks rules, and `cf77f2`, the composite over them and `3e12e1`. Added `2ee8b8`, visible label is part of accessible name.

### Fixed

- `marlo scan --json` truncated at 65526 bytes when stdout was a pipe, producing a file that looked like a report and would not parse. `process.exit()` after `console.log` killed the process before the write drained. See [HONESTY.md](HONESTY.md#2-a-report-file-that-looked-complete-and-was-not).
- The HTML CodeSniffer adapter typed `message.element` as a string and crashed 13 rules on the first real page it saw.
- Marlo's own site failed Marlo's own bar on the first audit: 48 tap targets under 24 CSS pixels, a 2.18:1 contrast failure in light mode, and four scrollable regions unreachable by keyboard. All fixed, and the audit harness that missed them was fixed too, since it had been loading pages over `file://` with no stylesheet.
- The site's scroll reveal held text at partial opacity for as long as a reader left a section straddling the fold, which axe measured at 4.22:1 and 3.39:1. A scroll-linked animation has no clock, so every point in its range is a state that has to pass on its own. See [HONESTY.md](HONESTY.md#6-the-sites-own-decoration-failed-the-sites-own-contrast-bar).
- The scoreboard ranked HTML CodeSniffer first, labelled `best`, because an engine that never reports a failure has a false positive rate of zero. On a site whose argument is that saying nothing is not the same as being right. An engine now only enters the ranking if it detects something.
- The site had no navigation at all below 48em, so four of five pages were unreachable from a phone.
- Icon SVGs carried no intrinsic dimensions, so the GitHub glyph expanded to fill a full-width button.
- `favicon.svg` was drawn in a different cyan from the one the stylesheet rendered, so the browser tab did not match its own page. The palette is recorded once and a test compares the assets against it.

- The coverage gate had never run. `vitest.config.ts` declared 85/80/85/85 and no CI job invoked it, so it failed on its first invocation. Thresholds are now the measured figures rounded down (86 statements, 87 lines, 90 functions, 72 branches) with a CI job that runs them, `pull-request.ts` went from 0 percent to 16 tests, and `invariant.ts` is back at 100 on every metric. Two of its uncovered branches were deleted rather than tested: one guarded a routing state the schema now forbids, the other narrowed a value the logic had already narrowed. See [HONESTY.md](HONESTY.md#8-the-coverage-gate-had-never-run-and-failed-the-first-time-it-did).

- `marlo scan page.html --renderer static` tried to open a file named `static`. The file list was built by filtering argv for anything not starting with a dash, which catches every flag value too. Found by writing the GitHub Action, which passes `--renderer` on every call; no test in the CLI had ever passed a value to a flag.

- `tests/e2e/browser.browser.test.ts` and a CI job for it. The browser renderer renders and declares `layout` and `paint`, and no engine can evaluate a Playwright page, so nothing downstream can consume it. The test asserts no engine returns a verdict it could not have earned, and it fails the day somebody makes that path work. See [HONESTY.md](HONESTY.md#9-a-renderer-with-no-engine-behind-it-and-nobody-had-noticed).

### Coverage

Repair is measured by the same gate as everything else, and the gate refuses most of it.

|                                                     |     |
| --------------------------------------------------- | --- |
| Rules with a mechanical codemod                     | 7   |
| Of those, cleared for auto-fix on the current table | 2   |
| Verified fixes on `apps/demo/checkout.html`         | 3   |
| Flagged for a human on the same file                | 31  |

`24afc2`, `78fd32` and `9e45ec` are refused with the measurement attached: Marlo's own detection for them is right between 29 and 33 percent of the time, against a threshold of 0.95. The generated change travels with the flag and is not applied.

`e6952f` has a working codemod and no engine that detects it, so nothing calls it. Source location is what makes that rule visible at all, which is now the shortest path from written code to a working fix.

- Alfa's adapter had no handle guard, so a renderer it could not read failed with `Cannot read properties of undefined (reading 'createRange')` rather than the explanation the other two adapters give. Two of three peers explained themselves and nothing had compared them, because nothing had ever run that path.

### Notes

- `trymarlo.pages.dev` is the canonical URL. `marlo.pages.dev` was taken: Cloudflare assigned a suffixed subdomain, which is not the documented target, so the project was recreated under the fallback name from the build brief.

[Unreleased]: https://github.com/KarthikSubramanian07/Marlo/commits/main
