# @marlo/schema

Every artifact Marlo produces, and its runtime validator.

This package is the vocabulary. It depends on nothing else in the repository, because a vocabulary that depended on a speaker would not be one. That is asserted by a dependency-cruiser rule rather than left to convention.

## The four claims this package enforces

Read these before the pipeline. They are the reason the types are shaped the way they are, and each one has a test that fails if it stops being true.

**A fix cannot be reported without its verification.** `Repair` is a discriminated union of `VerifiedFix` and `Flag`. `VerifiedFix.verification` is required and non-nullable, and there is no state meaning "claimed", "attempted", or "probably fixed". It is not possible to construct a value that says a repair worked without attaching the measurement that showed it.

**A rule that did not run cannot be read as a pass.** `RuleResult.status` is `ok | error | unsupported` and has no default. A rule that threw, a rule the renderer could not evaluate, and a rule that ran and found nothing all have an empty `verdicts` array; `status` is the only thing that tells them apart, which is why it cannot be omitted.

**Coverage cannot be stated without its denominator.** `Coverage` has no percentage field, and `formatCoverage` is the only sanctioned way to render it. A consumer that wants a percentage has to divide, at which point it is holding the denominator.

**An edit cannot silently corrupt a file.** `Edit` carries `before`, the exact bytes its range covers, validated to match the range length. Application compares it against the file and refuses if the file changed underneath. `EditKind` is a short closed allow-list with no entry for rewriting, reformatting, or reordering.

## Notable exports

| Export                                       | What it is                                                          |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `Outcome`                                    | ACT's four outcomes, including `cantTell`                           |
| `ACT_ALLOWED_OUTCOMES`                       | The official W3C grading protocol, as frozen data                   |
| `CalibrationTable`                           | The load-bearing artifact, with both accuracy views                 |
| `Repair`, `isVerifiedFix`, `isFullyVerified` | Fixes and flags                                                     |
| `formatCoverage`                             | The one way to state coverage                                       |
| `SEVERITY_PRESENTATION`                      | Severity with a text mark, so no surface encodes it by colour alone |
| `RENDERER_CAPABILITIES`                      | What each renderer provides                                         |
| `parseEnvironment`, `redactConfig`           | Configuration, parsed rather than read                              |
| `EXIT_CODES`                                 | So the CLI, the Action and the docs cannot disagree                 |

## Purity

No filesystem, no network, no `process.env`. `parseEnvironment` takes the environment as an argument, which keeps the package pure and makes it testable without mutating a global every other test shares.

`as` assertions are an ESLint error here. A trust boundary that casts instead of parsing is the exact failure Zod is present to prevent, which is also why `freeze.ts` exists: it fixes the `Object.freeze(['a', 'b']) as string[]` widening problem with a generic rather than an assertion.
