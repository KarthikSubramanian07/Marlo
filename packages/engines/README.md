# @marlo/engines

Peer engine adapters, and the hand-written mapping from each engine's rule identifiers to ACT rule identifiers.

## The mapping is the point

No accessibility engine publishes one. Checked, not assumed:

- **axe-core** carries an `ACT` tag on 85 of its 105 rules, and no ACT rule identifiers anywhere.
- **Alfa** exports 89 rules; 76 carry non-criterion requirements, and every one is a WCAG technique or a European Accessibility Act reference. Never an ACT rule.
- **HTML CodeSniffer** reports WCAG technique codes only.

Writing and maintaining that mapping is the labour this project consists of, and it is the second-highest-value contribution surface after new rules. It is why the calibration table is an asset rather than a script.

## The axe table was derived from evidence

Every entry was proposed by running axe-core over **all 1134 official ACT test cases**, recording which axe rules fired on which examples, and reviewing the correlations by hand. Reproduce with:

```
pnpm mappings:discover --engine axe
```

Notes read as `f` fired on a failing example, `p` on a passing one (a false positive), `i` on an inapplicable one, `ct` returned `cantTell`.

### Two findings from that run

**ACT test case documents are minimal fragments**, so axe's page-level rules fire on nearly everything: `landmark-one-main` on 1110 of 1134 cases, `page-has-heading-one` on 1075, `document-title` on 1006, `region` on 774, `html-has-lang` on 809. A naive correlation would "discover" that `landmark-one-main` implements 90 of 91 ACT rules. The discovery script separates rules firing on more than a quarter of the corpus, and the two cases where a page-level rule genuinely is the right mapping were checked individually.

**axe's `color-contrast` returned `incomplete` on all 19 of `afw4f7`'s test cases and never `failed`**, because happy-dom does not lay out and the colours cannot be resolved. It declined rather than guessing. That is the same conclusion the capability model reaches by declaration, arrived at independently by axe at runtime, and it is a nice independent check on [D-005](../../DECISIONS.md#d-005).

## Alfa and HTML CodeSniffer are smaller and more cautious

Alfa cannot go through the discovery script: its modules read DOM globals at import time and must be loaded inside `withDomGlobals`, so its discovery runs through the calibration harness. Its table is currently a set of documentation matches, and **every entry is marked `partial`** with a test asserting that, because matching prose is not a measurement.

Alfa earns its place regardless of table size: its outcome vocabulary is `passed | failed | cantTell | inapplicable`, ACT's exactly. Its column carries no translation error, which no other peer can say.

HTML CodeSniffer is the one to trust least, and the adapter says so at the top of the file. It has no `passed` and no `inapplicable`, so the adapter infers a pass from silence. That inference is the weakest step in this package.

## Two rules no adapter may break

Both are enforced by `assembleReport` rather than by each adapter remembering:

1. **Every requested rule appears in the output.** A rule the engine does not implement comes back `unsupported`, not omitted. An omitted rule reads as a pass to anything counting results.
2. **A rule that threw comes back `error`.** Never a pass, never folded into "found nothing".

`collapseOutcome` orders `failed` > `cantTell` > `passed` > `inapplicable`. Promoting `cantTell` to `passed` because some other element passed is how a tool reports clean on a page it did not understand.
