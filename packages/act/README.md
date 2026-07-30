# @marlo/act

The ACT rule corpus as data, the official W3C grading protocol, and the accuracy and coverage arithmetic every published number is computed with.

Pure: no filesystem, no network, no ambient state. Asserted by a dependency-cruiser rule rather than left to convention.

**Held at 100 percent coverage in CI, with no exceptions.** Every accuracy claim Marlo makes is arithmetic performed in this package. A partly covered grading protocol means an unmeasured accuracy claim, which is the failure this project exists to argue against.

## The denominator

`PUBLISHED_ACT_RULE_COUNT` is generated from the vendored corpus, not typed by hand. It is 94 at the corpus revision in this repository, and it is the number below the line in every coverage fraction Marlo prints.

`UNMEASURABLE_ACT_RULES` names the three published rules that carry no official test cases. They can be implemented and they cannot be calibrated, and the difference has to be stated rather than left as a blank a reader will read as a zero.

## The two accuracy views

`protocol.ts` implements W3C's grading protocol, from `pages/implementations/mapping.md` in the ACT rules repository. `accuracy.ts` implements the strict view, where `cantTell` is not a detection.

The reason for both is in [DECISIONS.md](../../DECISIONS.md#d-004). The one-line version: `cantTell` is an allowed outcome for every example type, so a tool that answers `cantTell` on all 1134 official test cases grades as a correct implementation of all 91 rules that have them. There is a test named after exactly that, and it asserts both halves: `consistencyOf` returns `consistent`, and strict recall is 0.

## Decisions inside the arithmetic

Each of these could reasonably have gone the other way, and each changes every published number.

**A failing example answered `cantTell` is a false negative.** The violation was there and it was not reported. Generous grading would call it partial credit; a developer whose page ships broken did not receive partial credit.

**A passing example answered `cantTell` is not a false positive.** Nothing was asserted, so nobody was misled. It lands in `cantTellOnPassed`, published as its own column.

Both `cantTell` columns are published because low recall from caution and low recall from incapacity look identical in a single number, and telling them apart is the point of the table.

**A rate with a zero denominator is `null`, never `0`.** Precision over zero predictions is an absent measurement, not zero precision. Reporting it as 0 would make a silent engine look maximally wrong.

**A case that never ran is excluded from every count.** Counting a crash as a miss makes a throwing engine look merely insensitive; counting it as a pass is the sibling project's defect.

**Aggregation pools confusion matrices rather than averaging rates.** An unweighted mean of means lets a rule with two test cases move the headline number as much as a rule with twenty-nine.

**The auto-fix threshold is on precision, not recall.** A missed violation is a gap the developer already had. A wrong fix is a change to their code they did not ask for.

## The generated index

`rules.generated.ts` is produced by `pnpm act:index` from `corpus/act/MANIFEST.json`. It is generated rather than read at import time because this package is pure.

`rules.test.ts` reads the manifest and asserts the generated file agrees with it, field by field, for all 94 rules. That test is the only reason this package's tests are permitted filesystem access, and the dependency rule carries the reasoning. `pnpm act:index:check` fails if the file is stale, and CI runs it.
