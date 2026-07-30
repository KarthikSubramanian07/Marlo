# @marlo/report

The four surfaces a finding can leave through: the terminal, a pull request body, SARIF, and the JSON report.

## `invariant.ts` is the important file

**If any peer engine reports a failure for an ACT rule, Marlo may not report clean.**

Borrowed from the sibling PDF project, whose worst defect survived because two checkers agreed with each other and both were wrong while veraPDF disagreed and was right. Marlo may dissent, and only explicitly and on the record, with the disagreeing engine named and the calibration evidence for preferring the router's verdict attached.

Held at 100 percent coverage. An uncovered branch here is a path where Marlo reports clean while a peer reported a failure.

The test is exhaustive rather than by example: **256 combinations**, four engines by four outcomes, asserting that no combination containing a `failed` produces anything other than `failed`. An invariant checked by three examples is an anecdote. It also asserts the detector can detect, by handing it a fabricated violation, because a checker that always returns empty proves nothing.

Two things it deliberately does **not** treat as dissent: a crash and an unsupported rule. A peer that threw did not report a failure, and letting a flaky engine force Marlo's verdict would be a different bug.

## The terminal surface

Three rules, each a decision:

**Severity is never colour alone.** Every severity prints a text mark (`···`, `▲`, `▲▲`, `▲▲▲`) from `SEVERITY_PRESENTATION`. The output is complete in a pipe, in a CI log, on a monochrome terminal, and for a reader who cannot distinguish red from amber. A test asserts the plain output contains no escape sequences and still conveys severity.

**What was not examined comes first**, above the findings, not in a footnote. A test asserts `NOT EXAMINED` appears before the first `critical`. "No contrast problems were found" and "contrast was not examined" are different sentences.

**Truncation announces itself.** A list of five findings for a rule with forty implies the rule has five.

Every finding carries where its accuracy figure came from: which engine reported it, that engine's measured precision, and how many official test cases that rests on.

## The pull request body

Ordered so a reviewer who reads only the first screen already knows what was wrong, which criterion it breaks, and how to say no.

Verification is rendered as **three questions answered**, not as the word "verified": did the target rule stop failing, did anything else start failing, is the change idempotent. Section 6 is how to reject one change, all of them, or permanently, because a pull request that does not say how to say no is not opt-in in practice.

Fenced code blocks compute their own fence length from the content, so a source excerpt containing backticks cannot break out of its block into the surrounding markdown.

## SARIF

SARIF 2.1.0, with per-engine provenance on every result: the reporting engine, its own rule id and version, the routing reason, every disagreement, the measured precision and recall, and the sample size behind them. A reader can decide how much weight to give a finding without asking anyone.

Rules that could not be evaluated appear as `toolExecutionNotifications` at `warning` rather than being omitted, because every SARIF consumer reads an absent rule as a rule with nothing to say.
