# Workstreams

How this repository was built, in the order the dependencies allowed, and what could have run at the same time. Kept because the shape of the parallelism is the argument for the shape of the packages.

## The map

```
research gate (#1)
      |
      v
foundation (#28) ---- corpus (#21)
      |                    |
      v                    v
   schema (#22)  ------> act (#23)
      |                    |
      +----> render (#24)  |
      |          |         |
      |          v         v
      |      engines (#25) |
      |          |         |
      |          `----> calibrate (#27) <---- rules (#26)
      |                    |
      |                    v
      `-------------> report + cli (#30)
                           |
                           v
                    site (#31) ---- docs (#31)
```

Nine of the eleven merged in dependency order with green CI. The two things that could genuinely have run in parallel with anything, `rules` and `engines`, are exactly the two that cannot see each other, which is the enforced boundary from [ARCHITECTURE.md](ARCHITECTURE.md) showing up as a scheduling property.

## Streams

**A. Measurement.** Research gate, corpus vendoring, `@marlo/act`, `@marlo/calibrate`. The critical path, because nothing downstream can claim anything until the table exists. Ends at `calibration/table.json`.

**B. Detection.** `@marlo/render`, `@marlo/engines`, `@marlo/rules`. Blocked only on `@marlo/schema`. Once schema landed, all three could have proceeded independently, and `rules` was written without reference to `engines` because the dependency rule forbids the import.

**C. Product.** `@marlo/report`, `@marlo/cli`, the site. Blocked on the table, since routing decisions and every published figure read from it.

**D. Discipline.** The claim and prose scanners, the DCO check, the architecture rules, the duplicate check, the licence ledger. Landed in the foundation on purpose. Every one of them caught something afterwards, which is the only evidence a check is worth having.

## Still open

| Stream    | Work                                                                                                                                                        | Blocked on                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repair    | Source location, minimal diff, the codemod layer with property-based tests ([#10](https://github.com/KarthikSubramanian07/Marlo/issues/10))                 | Nothing. Available now.                                                                                                                                                                 |
| Repair    | The verification loop: re-run the rule on the patched tree, keep the fix only if it passes ([#11](https://github.com/KarthikSubramanian07/Marlo/issues/11)) | #10                                                                                                                                                                                     |
| Surfaces  | MCP server ([#14](https://github.com/KarthikSubramanian07/Marlo/issues/14)), GitHub Action ([#15](https://github.com/KarthikSubramanian07/Marlo/issues/15)) | Read-only versions are unblocked. The write paths want #10.                                                                                                                             |
| Evidence  | The broken demo app and committed golden files ([#16](https://github.com/KarthikSubramanian07/Marlo/issues/16))                                             | Nothing. Available now.                                                                                                                                                                 |
| Detection | The other 59 ACT rules                                                                                                                                      | Nothing. One file each, and the [good first issue](https://github.com/KarthikSubramanian07/Marlo/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Anew-rule) list is sized for an afternoon. |
| CI        | Performance budget, supply chain pinning beyond action SHAs ([#18](https://github.com/KarthikSubramanian07/Marlo/issues/18))                                | Nothing.                                                                                                                                                                                |

Four of those six are unblocked, which is what the package boundaries were for.

## How the work was sized

Every pull request answers one question and can be reviewed in one sitting. `@marlo/act` is separate from `@marlo/calibrate` even though nothing else consumes `@marlo/act` on its own, because "is this arithmetic correct" and "is this harness measuring the right thing" are two different reviews, and the second one is much harder to do while also checking a ratio.

The one place that broke down: the foundation pull request is large, because a repository standard is not divisible. It introduces the type configuration, the architecture rules and the four scanners at once, and none of them work in isolation.

## What went wrong with the process

Recorded because the next person will hit it.

**Deleting a branch on merge closed the child pull request.** Merging a stacked branch with `--delete-branch` auto-closed the pull request stacked on it, and it had to be recreated with a new number. Do not delete branches while a stack is open.

**Every rebase merge invalidated the next child.** Squash and rebase merges rewrite SHAs, so each child had to be rebased onto `origin/main` immediately before its own merge. Merging a stack is a serial operation, one rebase per merge, no shortcuts.

**Numbers in this repository are shared between issues and pull requests.** #2 to #19 are issues. The first pull request is #1 and the next is #20. This is normal GitHub behaviour and it confuses everyone once.
