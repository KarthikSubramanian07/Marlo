# @marlo/repair

Source location, minimal diffs, and the verification that makes a fix a fix.

```bash
marlo fix checkout.html            # says what it would do, changes nothing
marlo fix checkout.html --write    # applies only what it verified
```

## What it will not do, which is most of it

Seven rules have a mechanical codemod. On the current calibration table **two** of them clear the auto-fix threshold. The other five come back as flags, carrying the measurement that disqualified them and the generated change, unapplied.

Run against `apps/demo/checkout.html`:

```
3 verified, 31 flagged for a human

  FIXED  b4f0c3  Meta viewport allows for zoom
      - content="width=device-width, initial-scale=1, user-scalable=no, maximum-scale=1"
      + content="width=device-width, initial-scale=1"
      verified: target closed, nothing else broke, applying twice is the same as once

  FLAG   24afc2  Important letter spacing in style attributes is wide enough
      not fixed: below-threshold
      marlo reports 24afc2 with strict precision 0.29 over 16 official test cases,
      against a threshold of 0.95. The fix below is mechanical and is still not
      applied, because the detection it rests on is not accurate enough.
```

That is the gate working rather than a shortfall. A codemod admitted because it looks correct, for a rule whose detection is right 29% of the time, applies four wrong edits for every right one.

## Three questions, asked separately

`Verification` has three boolean fields, not one:

|                   |                                                                          |
| ----------------- | ------------------------------------------------------------------------ |
| `targetClosed`    | The rule it targeted no longer fails, on every engine that implements it |
| `noNewViolations` | No rule that passed before the edit fails after it                       |
| `idempotent`      | Applying the edits twice is the same as applying them once               |

They are separate because passing two and failing the third is a fix that broke something else, and that has to be a flag rather than a success with a footnote. `noNewViolations` is the one that matters most and is easiest to skip: a codemod that closes its target and opens a different violation has made the page worse while reporting a win. Answering it honestly means a full re-run, and this does one.

`Repair = VerifiedFix | Flag` in `@marlo/schema` has no `attempted` case, so an unverified fix has no representation to construct. This package cannot produce one however it is called.

## Why a rule gets a codemod

Only when the correct edit follows from the markup with **no judgment**. That is narrower than "the fix is obvious to me", and it excludes most of what Marlo detects: a page with no `lang` needs to know the language, a missing accessible name needs the meaning, a duplicated `id` needs to know what references it, and contrast is somebody's design decision.

What is left is seven rules, and every one is a deletion or a rename. Nothing here invents content.

## The rule no DOM can see

ACT rule `e6952f` is "attribute is not duplicated", and no engine can detect a violation of it. Every HTML parser drops the second occurrence before a tree exists, so `<input name="a" name="b">` and `<input name="a">` are the same document by the time anything looks. `apps/demo/expected.json` had recorded it as undetectable for that reason.

Source location makes it visible, and the fix is mechanical: the browser already ignores the later occurrence, so deleting it changes nothing except the ambiguity. The codemod works. No engine reports the rule, so nothing calls it yet, and that is now the shortest path in the repository from written code to a working fix.

## What the property tests found

Six properties over the codemod layer, and one of them earned its place before any of this shipped.

Given `<input aria-labeledby="" aria-labeledby="">`, the ARIA name codemod renamed the occurrence the parser showed it. That unmasked the second copy, producing `aria-labelledby="" aria-labeledby=""`. Applying it again renamed that one too, and the result was a document with the same valid attribute twice. One violation turned into a different one, idempotence broken, and every step correct in isolation.

**No codemod now edits an attribute that is written more than once**, because the parser only ever shows it one of them. The invariant is stated once, in `codemod.ts`, and all three attribute-editing codemods check it.

## Why parse5

A scanner over HTML that is correct for comments, raw text elements, unquoted attributes, malformed nesting and character references is not a hundred lines, and getting it wrong means an edit applied to the wrong range. That is the single worst thing this codebase could do. parse5 is the tokeniser jsdom uses, is MIT, and reports per-attribute byte offsets.

The one thing it is used for beyond that is bounded: attribute occurrences are re-read from the bytes inside a start-tag range the parser has already identified, which is a much smaller problem than tokenising HTML.

## Where it refuses to guess

`locate` returns null when a description matches zero elements **or more than one**. A repair with no location becomes a flag with reason `source-not-located`. An edit applied to the wrong one of two candidates is worse than no edit.

Elements the parser implied rather than read, `tbody` being the common one, have no source location and are skipped. They were never written down, so they cannot be edited.
