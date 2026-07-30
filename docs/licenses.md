# Third-party licence ledger

Marlo is MIT. This is every third-party work it depends on or vendors, the licence, the obligation that licence creates, and how Marlo satisfies it.

Kept by hand rather than generated, because the interesting column is "obligation" and no tool infers that. `pnpm licenses:check` verifies that the set of production dependencies in the lockfile is the set listed here, and fails if a dependency appears that has not been reasoned about.

---

## Vendored works

Copied into this repository, so the obligations are live.

### ACT-Rules Community test cases

- **Where:** `corpus/act/`
- **Upstream:** [act-rules/act-rules.github.io](https://github.com/act-rules/act-rules.github.io), via [`act-rules.github.io/testcases.json`](https://act-rules.github.io/testcases.json)
- **Licence:** [W3C Software and Document Licence](https://act-rules.github.io/pages/license/)
- **Obligation:** the full notice must be included in a location viewable to users of the redistributed work; pre-existing notices must be preserved; any changes must be marked with a copyright statement identifying the source document.
- **How satisfied:** `corpus/act/NOTICE.md` carries the full notice verbatim plus the attribution statement the licence prescribes. `corpus/act/MANIFEST.json` records the retrieval date and per-file digests. No test case content is modified; `scripts/fetch-act-corpus.mjs` reproduces the copy exactly, and `pnpm corpus:verify` fails if a vendored file differs from its recorded digest, which means a local modification cannot go unmarked.

### ACT Rules Format 1.1

- **Where:** not vendored. Implemented against.
- **Upstream:** [W3C Recommendation](https://www.w3.org/TR/act-rules-format/)
- **Licence:** W3C Document Licence, with royalty-free implementation commitments from the Working Group.
- **Obligation:** none created by implementing a specification.
- **Note:** the royalty-free commitment is why this is safe to build a commercial-adjacent product on, and it is the reason ACT was chosen over any vendor's rule taxonomy.

---

## Production dependencies

Shipped in the published packages.

| Package                     | Licence      | Obligation                                                                                                                                                   | How satisfied                                                                                                                                                                                      |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axe-core`                  | MPL-2.0      | File-level copyleft: anyone who modifies axe-core's own source files must make those files available under MPL-2.0. Does not reach code that merely uses it. | Consumed as an unmodified npm dependency. Marlo does not patch, fork, or vendor it, so the obligation is not triggered. The adapter in `packages/engines/src/axe/` is Marlo's own code and is MIT. |
| `@siteimprove/alfa-*`       | MIT          | Preserve copyright and permission notice.                                                                                                                    | Notice preserved in `node_modules` as installed and attributed here.                                                                                                                               |
| `html_codesniffer`          | BSD-3-Clause | Preserve copyright notice, list of conditions, and disclaimer. The third clause forbids using Squiz Labs' name to endorse derived products.                  | Attributed here and in `README.md`; Marlo makes no endorsement claim.                                                                                                                              |
| `happy-dom`                 | MIT          | Preserve notice.                                                                                                                                             | Attributed here.                                                                                                                                                                                   |
| `zod`                       | MIT          | Preserve notice.                                                                                                                                             | Attributed here.                                                                                                                                                                                   |
| `@modelcontextprotocol/sdk` | MIT          | Preserve notice.                                                                                                                                             | Attributed here.                                                                                                                                                                                   |

### On MPL-2.0 and shipping under MIT

Worth stating explicitly because it is the licence question a downstream user will ask.

MPL-2.0 is file-scoped. It obliges publication of _modifications to the covered files_, not of code that links against them. Section 3.3 permits distributing a larger work under other terms provided the covered files remain under MPL-2.0. axe-core arrives from npm unmodified and stays that way, so:

- Marlo's own source is MIT.
- axe-core's files remain MPL-2.0 and are obtainable from Deque and from npm.
- A downstream user who wants to avoid MPL entirely can run Marlo with the axe adapter disabled. It is one engine of four behind an interface, and the calibration table will show what accuracy that costs, per rule, which is a better answer than a licence footnote.

---

## Development dependencies

Not shipped. Listed because a build-time dependency with an unusual licence is still a supply chain fact.

| Package                         | Licence            |
| ------------------------------- | ------------------ |
| `typescript`                    | Apache-2.0         |
| `vitest`, `@vitest/coverage-v8` | MIT                |
| `eslint`, `typescript-eslint`   | MIT                |
| `prettier`                      | MIT                |
| `playwright`                    | Apache-2.0         |
| `fast-check`                    | MIT                |
| `dependency-cruiser`            | MIT                |
| `parse5`                        | MIT                |
| `fast-check`                    | MIT                |
| `wrangler`                      | MIT and Apache-2.0 |
| `lefthook`                      | MIT                |

`parse5` is the only production dependency added since the foundation, and it is worth one line of justification. It is the HTML tokeniser jsdom uses, and the repair layer needs per-attribute byte offsets. The alternative was a hand-written scanner, and the failure mode of getting HTML tokenising subtly wrong is an edit applied to the wrong range, which is the single worst thing this codebase could do.

Playwright downloads Chromium, which is BSD-3-Clause with a large set of third-party notices of its own. It is not a declared dependency at all: `pnpm screenshots` prints the one-line install command when it is absent, and `pnpm check` never needs it.

---

## Typefaces, vendored into the site

Both are served from `trymarlo.pages.dev` itself rather than from a font CDN, which is what lets the site's content security policy keep `font-src` at `'self'` and make no third-party request from any page.

| File                                             | Family         | Licence                                                                                   | Obligation                                                                                                                                                                                                   |
| ------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/site/src/fonts/dm-sans-latin.woff2`        | DM Sans        | [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/) | Redistribution is permitted, including as part of a larger work, and the licence travels with the font. The font is not sold on its own and is not renamed, so the reserved font name clause is not engaged. |
| `apps/site/src/fonts/jetbrains-mono-latin.woff2` | JetBrains Mono | [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/) | Same terms. Used for the accuracy figures, the rule identifiers and the recorded terminal output.                                                                                                            |

Both are the latin subset only, 68 KB for the pair, variable weight. The subset is the unmodified upstream file as served by Google Fonts, not a re-subset, so nothing is a derivative work and no name change is required.

---

## Works studied but not used

No obligation, recorded because the reader of a licence ledger is often looking for whether something was copied.

| Work                                                                                                         | Licence    | Relationship                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`krishaygarg/ada_pdf_remediation`](https://github.com/krishaygarg/ada_pdf_remediation)                      | MIT        | Design and epistemology cited throughout [RESEARCH.md](../RESEARCH.md) and [DECISIONS.md](../DECISIONS.md). Two of its tests are reimplemented from their description in `apps/site/test/no-theatre.test.ts`. No code copied. |
| [`jrpool/testaro`](https://github.com/jrpool/testaro), [`jrpool/testilo`](https://github.com/jrpool/testilo) | MIT        | Studied for its failure mode. No code copied.                                                                                                                                                                                 |
| [`priyankark/a11y-mcp`](https://github.com/priyankark/a11y-mcp)                                              | MPL-2.0    | Studied for MCP tool surface. No code copied, which also means no MPL obligation.                                                                                                                                             |
| [`ronantakizawa/a11ymcp`](https://github.com/ronantakizawa/a11ymcp)                                          | MIT        | Studied for MCP tool surface. Its `test_html_string` primitive influenced Marlo's decision to accept source directly. No code copied.                                                                                         |
| [`IBMa/equal-access`](https://github.com/IBMa/equal-access)                                                  | Apache-2.0 | Deferred adapter. Apache-2.0 requires a NOTICE file be propagated if one is present; that obligation arrives with the adapter, not before.                                                                                    |
| [`qualweb/core`](https://github.com/qualweb/core)                                                            | ISC        | Deferred adapter.                                                                                                                                                                                                             |
| [`validator/validator`](https://github.com/validator/validator)                                              | MIT        | Deferred.                                                                                                                                                                                                                     |

---

## How to add a dependency

1. Add it, and add a row here with the obligation column filled in. Not the licence name: the obligation.
2. If the licence is anything other than MIT, BSD, ISC, or Apache-2.0, say in the pull request why it is acceptable.
3. `pnpm licenses:check` must pass. It fails on a production dependency that is not listed here, and on a licence outside the allow-list in `scripts/check-licenses.mjs`.

Copyleft that reaches Marlo's own source, meaning GPL or AGPL in a production dependency, is refused. Not on ideological grounds: Marlo needs to be embeddable by the tools it measures, including the closed ones, or it cannot function as a shared calibration harness.
