# @marlo/rules

Marlo's own ACT rule implementations. **35 of the 94 published ACT rules.**

## One rule, one file, one registry line

That is the whole ceremony, and keeping it that way is the point: the contribution funnel is new rules, and a funnel with a registration step in four places is a funnel nobody uses. See [CONTRIBUTING.md](../../CONTRIBUTING.md#add-an-act-rule).

The package is pure: no filesystem, no network, no DOM library. A rule is a function over the structural interfaces in `dom.ts`, so it runs against a fixture built by hand in a test with no renderer anywhere. `fixture.ts` builds one from a markup string, which is why a contributor can write a rule test in isolation.

## It cannot see its peers, by construction

A dependency-cruiser rule forbids `@marlo/rules` from importing `@marlo/engines`, per [D-008](../../DECISIONS.md#d-008).

The sibling PDF project's worst defect survived because its auditor searched for the same wrong URI its writer emitted, so it confirmed its own bug and reported success. Marlo's engine is graded in the same calibration table as axe-core, Alfa and HTML CodeSniffer, and it must not be able to observe them while deciding. The small cost is that `evaluate.ts` assembles a report and so does `@marlo/engines`. That duplication is the enforcement mechanism.

## Two habits that run through every rule

**`cantTell` is a real answer.** Where a verdict would depend on something outside the DOM, the rule says so and explains what is missing. `bf051a` returns `cantTell` for `lang="xx"`, because that is well-formed BCP 47 and Marlo does not vendor the IANA registry, so it genuinely does not know whether `xx` is a language. Marlo's recall suffers, the calibration table publishes that cost, and the router sends the rule to whichever peer measures better.

**`requires` is honest.** The contrast rules declare `layout` and `paint`, which the static renderer does not provide, so they report `unsupported` rather than a verdict computed from styles that were never resolved.

That is asserted structurally rather than by reading source. `rules.test.ts` runs **every** rule twice, once with resolved styles present and once without, and fails if any rule that does not declare `layout` changes its verdict. A rule reading a computed style while claiming only `dom` would pass under the static renderer and fail in a browser, which is a false negative Marlo cannot see.

## The accessible name computation is deliberately incomplete

`accname.ts` covers the HTML-AAM subset the naming rules need, and returns a **confidence** alongside the name. `certain` means every input was in the DOM. `uncertain` means something outside it could change the answer, and a rule receiving `uncertain` returns `cantTell`.

A complete computation handles CSS generated content, `::before` and `::after`, and text alternatives resolved through the box tree. Those need `layout`. So a link containing an image gets `uncertain`, not a guess, and the calibration table shows what that caution costs in recall.

## Contrast: located, never fixed

Both contrast rules are `fixability: 'never'`, with a test asserting it. Recolouring is a design decision, and a repair layer permitted to pick a colour is exactly the "fix drifting into UI redesign" failure the LLM accessibility literature catalogues.

Even with `layout` available, they return `cantTell` and name the declared colours rather than asserting a ratio: computing it correctly needs the effective background behind any transparency, which is a paint-order walk this version does not implement. Locating the text is real value. Asserting a ratio Marlo has not correctly computed would not be.
