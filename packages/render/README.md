# @marlo/render

The renderer seam and the capability model.

## The one idea

A renderer declares what it provides. A rule declares what it needs. A rule whose needs are not met reports `unsupported`.

**Never a pass.** That single rule is the difference between "no contrast problems were found" and "contrast was not examined", and it is what lets Marlo run its default path with no browser without quietly claiming coverage it does not have.

It is the sibling PDF project's principle applied to a missing capability: a check that failed to run must never be indistinguishable from a check that found nothing.

## Three renderers

|                                | Capabilities                       | Cost                                        | Default |
| ------------------------------ | ---------------------------------- | ------------------------------------------- | ------- |
| `StaticRenderer` (happy-dom)   | `dom`, `script`                    | Free, in-process, offline, deterministic    | **Yes** |
| `BrowserRenderer` (Playwright) | `dom`, `script`, `layout`, `paint` | Free on compute the caller already pays for | Opt-in  |
| `RemoteRenderer`               | would be all four                  | Metered. **The first dollar**               | Never   |

`RemoteRenderer` throws and explains why in its own source. That is the design, not an omission: see [DECISIONS.md D-007](../../DECISIONS.md#d-007). An implemented remote renderer is a convenient thing to reach for, and the first dollar becomes an unbounded number of dollars when whoever reaches for it has not written the cap.

Playwright is an optional peer dependency, imported dynamically. `pnpm install && pnpm test` has to be green with no browser binary, so a static import would break the requirement the whole offline story rests on.

## Two limitations, stated rather than implied

**The static renderer executes inline page script.** This began as a `runScripts` option defaulting to false. The option did not work: happy-dom 20 runs inline scripts written through `document.write` under every combination of `disableJavaScriptEvaluation` and `enableJavaScriptEvaluation`, and `DOMParser.parseFromString` runs them too, which the HTML specification says it must not. An option named `runScripts: false` that runs scripts is worse than no option, so it was removed. There is a test asserting the real behaviour, so if happy-dom ever gains a working switch the test fails and someone revisits the documentation. Recorded in [HONESTY.md](../../HONESTY.md).

**The static renderer has no layout.** happy-dom parses CSS but does not lay out, so `getComputedStyle` returns declared values rather than resolved ones and there is no box model. `layout` and `paint` are therefore absent from its capability set rather than approximated, which is why the contrast rules report `unsupported` by default.

## `withDomGlobals`

Alfa's serialiser reads `globalThis.document` and calls `createRange()` on it, and does not accept a document argument for that part, so the window has to be global while it runs. This installs the specific names Alfa reaches for, runs the callback, and restores what was there before, including on a throw.

Restoring matters more than it looks: Vitest runs test files in one process, and a leaked `globalThis.document` makes an unrelated test fail somewhere else entirely. There are tests for all three cases.

It lives here rather than in the Alfa adapter because a dependency rule forbids an engine adapter from importing happy-dom directly. An adapter that reaches for the DOM itself could bypass the capability model, and then a rule needing layout could silently pass on a renderer that has none.
