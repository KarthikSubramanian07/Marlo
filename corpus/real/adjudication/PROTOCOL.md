# Adjudication protocol

How the ground truth for `corpus/real` is produced. Until it has been followed by two
raters, no real-page accuracy figure exists, and `calibration/table.json` says so.

A rater is a person or a language model, and every sheet says which. The ground truth
committed today was produced by two language models, as described under
[Model raters](#model-raters) below, and every figure that rests on it says so. A person
who rates later does so on fresh sheets, and the two kinds are never mixed on one sheet.

## The unit

One cell is one page by one ACT rule. Every page in `../MANIFEST.json` is crossed with
every rule in `IMPLEMENTED_RULES` from `packages/rules/src/registry.ts`, the rules Marlo
itself claims. Rules only a peer engine claims are not rated: Marlo's own figure is the
one this corpus exists to check.

## The answer

Each cell gets one of four answers and a note.

- `passed`: the rule applies to something on the page and every applicable element
  satisfies it.
- `failed`: at least one applicable element fails it.
- `cantTell`: it cannot be decided from the page file alone. This is an allowed ground
  truth, not a failure to answer. Some real cases are undecidable without asking the
  author what they meant, and forcing a binary answer would manufacture the certainty this
  project argues against. A resolved `cantTell` is counted in the table and never scored.
- `inapplicable`: nothing on the page is in the rule's applicability.

The note is required with `failed` and `cantTell`, and should name the element and the
reason, because a resolver will read it. It is optional with `passed` and `inapplicable`.

Judge the page as the snapshot shows it: the file under `../pages/`, opened in a browser
with network access off if you can, read alongside its source. The rule's own definition
on act-rules.github.io is the authority, linked from every cell.

## Two independent raters

Two raters, rater A and rater B, each fill in their own worksheet, `sheet-A.json` and
`sheet-B.json`. Neither opens the other's sheet, `DISAGREEMENTS.md` or `resolved.json`
before finishing. Neither looks at what any engine reported, and the worksheets contain
no engine output: they are generated from the page list and the rule list alone, by a
script that does not import an engine.

Each worksheet lists the cells in its own deterministic shuffled order, seeded by the
rater id, so the two raters meet the cells in different orders and fatigue does not land
on the same cells for both. Regenerating a sheet produces the same order every time.

## The mechanical pre-screen

A cell may be pre-filled `inapplicable` before a person sees it, on one ground only: no
element the rule applies to occurs anywhere in the page source. The patterns are written
out per rule in the `PRESCREEN` table in `scripts/adjudicate.mjs`, and a test fails if
the table does not cover exactly the implemented rules. Rules that apply to every page,
or whose applicability needs judgment, have no pattern and are never pre-screened.

A pre-filled cell is overridable. A rater who disagrees changes the answer, and the cell
then counts as rated like any other. A pre-screened cell both raters left alone is
resolved `inapplicable`, but only once both raters have finished that page, and it is
never part of the inter-rater agreement figure.

## Agreement

`node scripts/adjudicate.mjs agreement` computes Cohen's kappa and percent agreement
over the rated cells: every cell both raters answered, except pre-screened cells
both left alone. It writes `DISAGREEMENTS.md`, listing every cell where the two answers
differ, what each rater said with their note, and the resolution once there is one.
That log is committed and is meant to be read.

Kappa is undefined, and reported as undefined rather than as a number, when there are no
rated cells or when both raters gave one identical answer throughout.

## Resolution

A disagreement is resolved by a third person, or by the two raters together, writing an
entry in `resolutions.json`:

```json
{
  "resolutions": [
    {
      "page": "shop-03",
      "rule": "97a4e1",
      "answer": "failed",
      "resolver": "name of the person resolving it",
      "reasoning": "why this answer, in a sentence a reader can check"
    }
  ]
}
```

`node scripts/adjudicate.mjs resolve` merges the cells both raters agreed on, the
pre-screened cells described above, and the resolutions into `resolved.json`. It refuses
to write anything while any disagreement lacks a resolution, while a resolution is
missing its resolver or reasoning, or while a resolution tries to overrule two raters who
agreed. Cells still pending are left out.

## Grading

The calibration harness grades each engine only against cells in `resolved.json`, counts
the rest as unresolved, and never guesses. The real-page figures are published in their
own block of `calibration/table.json` and are never pooled with the ACT figures.

## Order of work

1. `pnpm build`, then `node scripts/adjudicate.mjs sheet --rater A` and `--rater B`.
   Both sheets are committed empty.
2. Each rater fills in their own sheet with `node scripts/rate.mjs --rater A` (or
   `--rater B`), which prints a local address to open in a browser. It shows the page
   snapshot offline beside one cell at a time, in the sheet's own order, saves every
   answer to the sheet as it is given, and runs the same validation as `validate` after
   each save. It serves that rater's sheet and nothing from the other rater, the
   disagreement log, the resolutions or any engine. Editing the JSON by hand is still
   allowed and gives the same result. When the sheet is finished, the rater runs
   `node scripts/adjudicate.mjs validate`.
3. `node scripts/adjudicate.mjs agreement`, then resolve every entry in
   `DISAGREEMENTS.md` in `resolutions.json`.
4. `node scripts/adjudicate.mjs resolve`, then `pnpm calibrate`.

## Model raters

A sheet may be answered by a language model instead of a person. The sheet then records
`"raterKind": "model"` and the model identifier in `raterModel`, a resolution records
`"resolverKind": "model"`, and `calibration/table.json` lists every rater with its kind
and model, so a figure resting on model ground truth can never be read as resting on
human judgment. `adjudicate.mjs validate` refuses a sheet with answers and no
`raterKind`, and a model rater without its model. The rating tool records its own
answers as a person's and refuses to continue a sheet a model answered.

The ground truth committed in this directory was produced this way:

- **Rater A** was `claude-opus-5-5`, **rater B** `claude-sonnet-5-5`: two different
  models, each run once per page in its own context, so neither saw the other's answers.
- **The resolver** was `claude-fable-5-1`, a third model. It saw only the cells the two
  raters disagreed on, with both answers and both notes, and re-examined the page before
  answering. It never saw a cell the raters agreed on, and `resolve` refuses a
  resolution that overrules an agreement, as it does for a person.
- **Blind to every engine.** Each rater received the page snapshot, the cell list, the
  normative text of each ACT rule (Applicability, Expectations, Assumptions and
  Accessibility Support, from the act-rules repository at commit
  `40fd79067532ef9ee2af50e36384a725c3157ee8`) and the ACT glossary, and nothing from this
  repository. They were instructed not to run or consult any accessibility checker,
  Marlo included, and to write any check they needed from the rule text. They could read
  the source, parse it with a plain DOM library, and evaluate scripts in headless
  Chromium with the page's own scripts off and every network request blocked, the same
  conditions as the rating tool people use.
- **The same answers and notes as a person gives.** Four answers, a note naming the
  element and the reason for every `failed` and `cantTell`, and the pre-screen treated as
  a suggestion that may be overridden.

**How accurate the raters are is measured, not assumed.** The same two raters, under
the same instructions and restrictions, rated every ACT test case for the rules Marlo
implements, with the files renamed so that nothing in a path or a name reveals the
expected outcome. The W3C's expected outcomes were written by people, so agreement with
them is an accuracy figure for the raters themselves. `RATER-VALIDITY.md` publishes it,
per rater and per rule.

**What this ground truth is not.** It is not human judgment, and the figures that rest on
it are labelled as model-adjudicated wherever they appear. The pages and the ACT test
cases are public, so a model may have seen them in training; the ACT measurement is the
check on how much that matters for the cases, and it cannot be one for the pages. A
person who rates these pages later uses fresh sheets with `raterKind` `person`, and the
two sets of figures are published side by side rather than merged.

## Corrections

**2026-10-20: ten cells pre-filled by patterns narrower than their rules.** The
pre-screen for `bc4a75` looked only for a `role` attribute, but the rule applies to
implicit roles too (`ul`, `ol`, `table` and others), and the pre-screen for `46ca7f`
missed `img alt=""`, which the ACT glossary counts as marked as decorative. Ten cells here
were pre-filled `inapplicable` on pages the rule applies to: `bc4a75` on two application
pages and two shop pages, and `46ca7f` on six pages. On the six, both raters had already
overridden the suggestion with `passed`. On the two shop pages the raters had disagreed and
the resolver had decided `passed`. On the two application pages both raters had left the
suggestion alone, so `inapplicable` had become ground truth.

The patterns were corrected and tested, and the same two raters rated all ten cells again
in a fresh context, with no pre-screen hint, under the same instructions. Both answered
`passed` on all ten, independently. Their answers replace the first-round answers on both
sheets, the two shop-page resolutions are withdrawn because nothing is left to resolve,
and `resolved.json` was rebuilt. The ground truth changed on the two application-page
cells, from `inapplicable` to `passed`; the other eight already said `passed`. The
held-out pages had seventeen cells pre-filled the same way, and they were corrected the
same way before their ground truth was committed.
