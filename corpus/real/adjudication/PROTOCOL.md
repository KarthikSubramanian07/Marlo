# Adjudication protocol

How the ground truth for `corpus/real` is produced. Until it has been followed by two
people, no real-page accuracy figure exists, and `calibration/table.json` says so.

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

Two people, rater A and rater B, each fill in their own worksheet, `sheet-A.json` and
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
then counts as human-judged like any other. A pre-screened cell both raters left alone is
resolved `inapplicable`, but only once both raters have finished that page, and it is
never part of the inter-rater agreement figure.

## Agreement

`node scripts/adjudicate.mjs agreement` computes Cohen's kappa and percent agreement
over the human-judged cells: every cell both raters answered, except pre-screened cells
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
