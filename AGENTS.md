# Agent conventions

Read this before changing anything. It is conventions only, and every line is here because something in this repository broke. Shape is in ARCHITECTURE.md, reasoning in DECISIONS.md, defects in HONESTY.md, current state in HANDOFF.md.

The product claim is a published error rate. A number nothing measured, and a check that cannot fail, are the two defects this project exists to argue against. Treat either as the highest severity thing on your list.

## Constants that live in more than one place

Grep the whole repository before changing a default. These have already drifted.

| Value                           | Every place it lives                                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage thresholds 87/73/90/88 | `vitest.config.ts` owns them. CONTRIBUTING.md restates them. HONESTY.md section 8 and the coverage comment in `.github/workflows/ci.yml` are both stale and disagree with each other                            |
| Auto-fix threshold 0.95         | `packages/schema/src/config.ts` twice, hardcoded again in `packages/calibrate/src/bin.ts`, prose in SETUP.md and calibration/README.md                                                                          |
| Node floor 22.13.0              | `.nvmrc`, `engines.node` in package.json, the test matrix in `.github/workflows/ci.yml`. Not arbitrary: vite 8 needs 22.12 and watskeburt 6 needs ^22.13                                                        |
| The published site origin       | `ORIGIN` in `apps/site/src/build.mjs`, plus eighteen other tracked files. SETUP.md lists four of them                                                                                                           |
| The site palette                | sRGB hex in `apps/site/src/style.css`. `build.mjs` reads the same list, and a test fails if `favicon.svg` uses a colour the stylesheet does not record. The tab icon and the page were once two different cyans |

## Editing

- Anchor every edit on a full unique line. Never delete from a matched substring to the next delimiter. Check the diff size after any scripted edit and revert if it is larger than you predicted.
- Every tracked file is LF. `.gitattributes` sets `* text=auto eol=lf`. Do not introduce CRLF.
- Never write the glob for package sources, the one spelled `packages` slash star slash `src` slash star star, inside a block comment. The star followed by a slash closes the comment early. That produced `ReferenceError: src is not defined` and cost an hour.
- Deleting something that looks unused needs proof, including a search of strings, templates, config and `tests/golden/`, which names surfaces rather than importing them.

## The checkers read this file too

`scripts/check-claims.mjs` and `scripts/check-prose.mjs` scan every file in the repository, documentation and generated output included. No suppression comment exists and adding one is refused.

- Nine claims are forbidden outright, about certification, guarantees, completeness and legal exposure. The patterns and the reason for each are in `scripts/lib/rule-data.mjs`, and the script prints the reason at you.
- No em dash and no horizontal bar, anywhere. Use a colon, a comma, parentheses or a full stop.
- A slop vocabulary list and two sentence constructions are refused as well. Same file.
- `scripts/lib/rule-data.mjs` is the only path either checker skips, because a pattern forbidding a phrase has to contain the phrase. `rule-data.test.mjs` asserts the skip list is exactly one entry long. Do not add a second.
- To discuss a forbidden phrase, write the sentence so the literal string never appears. This paragraph is written that way.

## Running the checks

`pnpm check` is what CI runs, and nothing CI runs sits outside it. It needs no network after install, no API key and no browser. If that stops being true, that is the bug rather than an inconvenience.

- `lint:code` must keep `NODE_OPTIONS=--max-old-space-size=6144`. Sixteen typed ESLint projects abort with SIGABRT under the default heap. Budget several minutes for it and do not assume it hung.
- Run `pnpm format` before committing markdown. Prettier rewrites markdown tables and `format:check` is a required check.
- `vitest.config.ts` rebuilds the workspace alias map inside every project entry, because Vitest 4 does not inherit the root `resolve`. If a new package cannot resolve a sibling, that is why.
- The corpus job in CI runs bare `node` with no package manager, deliberately. An earlier version called `pnpm` in a job that had none and failed with `command not found`.
- A gate is not a gate until something invokes it and you have watched it fail once. The coverage thresholds sat in `vitest.config.ts` for the entire build with no job calling them, and failed on four counts the first time one did.

## Coverage

`packages/act/**` and `packages/report/src/invariant.ts` are held at 100 with no exceptions. An uncovered branch in the first is an unmeasured accuracy claim. In the second it is a path where a clean report is printed while a peer engine reported a failure.

Branch coverage runs about 14 points under statement coverage and the gap is structural: under `noUncheckedIndexedAccess` every array index yields `T | undefined`, so each guard around one is a branch and many are unreachable by construction. When you find one, make the state unrepresentable and delete the branch. Do not write a test that constructs an impossible input to reach a defensive line.

## Published numbers

A figure in `calibration/table.json` that moved is a result to investigate, never a conflict to resolve. `pnpm calibrate:check` fails on an unrecorded improvement as well as on a regression, because a number rising for an unknown reason is the same problem as one falling.

A change that improves this project's own figures deserves more scrutiny than one that makes them worse. An over-strict harness filter once lifted precision from 0.71 to 1.00 by silently skipping 444 of 524 test cases, and it looked like caution.

This project's own engine is graded in the same table as its peers with no exemption, and it currently places third of four. Do not repair that by adjusting the harness.

## The corpus is immutable

`corpus/` is vendored, digest-verified and byte-exact. `.gitattributes` marks it `-text -diff` and `.editorconfig` turns off newline and whitespace normalisation for it. Never reformat it and never let an editor save through it. It is the ground truth under every published number, so an editable corpus means an inconvenient answer can be made convenient by changing the question.

## Rules and engines

- A rule declares the renderer capabilities it needs in `requires`. Anything reading a computed style, a bounding box, or a value downstream of CSS declares `layout`. Get this wrong and the rule passes under the static renderer, which is a false negative nothing can see.
- A rule is merged with a measurement the calibration harness produced. A poor measured number is publishable and gets routed to a better peer engine. An estimate is not publishable at all.
- Architecture is enforced by `.dependency-cruiser.cjs` rather than by convention: `@marlo/rules` cannot import its peers, engines reach the page through the render seam, and `@marlo/schema` depends on nothing else in the workspace.
- No direct `process.env` outside `packages/schema/src/config.ts`, so a required key cannot be introduced without appearing in SETUP.md. No `console` outside the bin entrypoints listed in `eslint.config.js`.

## Anything visual

Structural tests cannot see contrast, because contrast needs layout. Twenty-seven passing site tests let through a 2.18:1 failure and a 4.22:1 failure, and four more defects were found only by opening the screenshot at full size and reading it. Verify visual work in a real browser, at real widths, in both colour schemes, and look at the image rather than the assertion count.

`pnpm screenshots` is the gate. It fails on any critical or serious violation, any horizontal overflow, and any tap target under 24 CSS pixels. It serves the site over HTTP and asserts the stylesheet loaded, because an earlier version loaded pages over `file://` and measured the browser default styles.

An animation a reader can pause by not scrolling is a state rather than a transition, and every state has to pass on its own.

## Output surfaces

Set `process.exitCode` and return. Never call `process.exit()` after writing to stdout: when stdout is a pipe rather than a terminal the write is asynchronous, and the process can die before it drains. A JSON report once truncated at exactly 65526 bytes into a file that began like a report, would not parse, and raised no warning at all.

An engine adapter is unverified until a real page has been through it. Thirteen rules threw at once the first time the CLI was pointed at a real file, because an adapter typed a field as a string that the engine hands over as a live DOM node, and no unit test had used markup with that shape. `pnpm test:e2e` asserts that zero adapters error on the demo pages, so run it rather than trusting the unit project.

## Fixing a bug

Add a test that fails against the old code and guards the category, not the one instance that was reported. Cap anything unbounded: lists, retries, caches, queues. Never force a layout or a synchronous read inside a frame loop or any other hot path.

## Committing

- Work on a branch. `main` refuses a force push from everybody, including the repository owner, and requires ten green checks and a linear history.
- `<scope>: <what changed>`, imperative, lower case, no trailing full stop. The scope is the package or area. The body explains why, because the diff already says what.
- Sign off every commit with `git commit -s`. A `commit-msg` hook and a required check both verify it.
- Small and single-purpose. One rule per change is the target.
- Do not commit, push, open a pull request, or merge unless you were asked to.
- A sync tool has twice written `filename 2.mjs` duplicates into this repository, and one of them blocked a checkout mid-rebase. `pnpm lint:duplicates` fails on them. Delete rather than rename.
