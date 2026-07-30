# @marlo/cli

```
marlo scan index.html
```

## What it does that other scanners do not

**It tells you how much to trust each finding.** Every one carries the engine that reported it, that engine's measured precision for that specific ACT rule, and how many official test cases the measurement rests on. `marlo explain c487ae` prints the whole row for a rule, both accuracy views, and says so out loud when W3C's protocol would call an engine correct while it misses over half the violations.

**It tells you what it did not check, first.** The static renderer has no layout, so the contrast rules report as not evaluated, printed above the findings with the words "This is not a pass". A scanner that quietly omits what it could not do is how a page ships broken with a clean report.

**It refuses to pretend.** `marlo fix` exits 2 and says the repair layer is not merged. There is deliberately no `--fix` flag that does nothing, and `--renderer browser` is refused rather than silently downgraded to static, because a silent downgrade would report layout rules as unevaluated while the caller believed they had been checked.

## Verbs

|                          |                                                 |
| ------------------------ | ----------------------------------------------- |
| `marlo scan <file...>`   | Findings, with provenance and measured accuracy |
| `marlo explain <act-id>` | Every engine's numbers for one rule, both views |
| `marlo coverage`         | The fraction, with its denominator              |

`--json` and `--sarif` for machines. `--rule <act-id>` to run one rule. `--fail-on-skipped` to exit 3 when something could not be evaluated.

## Exit codes

|     |                                                                          |
| --- | ------------------------------------------------------------------------ |
| 0   | nothing found in the rules that were evaluated                           |
| 1   | findings                                                                 |
| 2   | Marlo could not run                                                      |
| 3   | incomplete: a rule crashed, or was skipped and you asked to fail on that |

**3 outranks 1 deliberately.** A caller treating 1 as "there is work to do" would otherwise read an incomplete measurement as a complete one.

## One bug worth knowing about

The first version called `process.exit()` straight after `console.log`. When stdout is a pipe rather than a terminal, `console.log` is asynchronous, so `marlo scan --json | tee report.json` truncated at exactly 65526 bytes, **silently**, producing a file that looked like a report and would not parse.

It sets `process.exitCode` and returns now, which lets Node flush stdout before exiting. Same exit code, all 105 KB of output. There is a test that pipes the JSON and parses it.
