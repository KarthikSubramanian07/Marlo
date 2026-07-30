# The Marlo Action

Checks changed HTML against the official ACT rules, with the measured accuracy of every finding attached. Read-only.

```yaml
name: Accessibility
on: pull_request

permissions:
  contents: read

jobs:
  marlo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # so the changed-file diff works
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
      - run: pnpm install --frozen-lockfile && pnpm run build
      - uses: KarthikSubramanian07/Marlo/.github/actions/marlo@main
```

## The first thing it does is refuse a token it does not need

Inside a GitHub Action, "Marlo never pushes" is not a statement about the code. Any step in a job with `contents: write` can push, and a reviewer reading a composite action cannot tell whether one does without reading all of it.

So the boundary is moved somewhere a reviewer can check in one line. The action's first step reads the permissions it was handed and **stops if they exceed what the work needs**:

```
marlo: refusing to run.

  the job grants `contents: write`. Marlo never commits, pushes, force pushes,
  rewrites history or deploys, so it does not need that permission and will not
  accept it. Use `contents: read`.
```

If somebody later adds a step that pushes, they have to delete that check too, and deleting it is a diff that says exactly what it is doing.

Where the runner does not expose `GITHUB_TOKEN_PERMISSIONS`, the step says the scopes **were not checked** rather than reporting a pass it did not earn. A check that degrades to "no data, therefore fine" is the class of defect [HONESTY.md](../../../HONESTY.md) is about.

The only write it can perform is a pull request comment, which needs `pull-requests: write` and is off by default.

## Inputs

|                         |                                                    |                                                                                                        |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `files`                 | Space-separated paths                              | Default: HTML changed in the pull request, or all HTML on a push                                       |
| `renderer`              | `static` or `browser`                              | Default `static`. `browser` needs Playwright in the job and evaluates the layout-dependent rules       |
| `fail-on`               | `critical` `serious` `moderate` `advisory` `never` | Default `serious`                                                                                      |
| `fail-on-not-evaluated` | `true` or `false`                                  | Default `false`. The honest default on a renderer with no layout is to report the gap, not block on it |
| `sarif-file`            | Path                                               | Write SARIF 2.1.0, for the code scanning tab                                                           |
| `comment`               | `true` or `false`                                  | Default `false`. Needs `pull-requests: write`                                                          |

## Outputs

`findings`, `not-evaluated`, `coverage`, `sarif`.

`not-evaluated` is there so a workflow can react to the gap rather than only to the failures. A job that reports "0 findings" without mentioning that two rules were never evaluated is doing the thing this project was built to argue against.

## The report

What was not examined comes first, then the findings, then the provenance. Every surface Marlo has puts them in that order, and the reason is that "no contrast problems were found" and "contrast was not examined" are different sentences.

Findings carry the reporting engine and its precision on that rule over the official test cases, and a disagreement between engines is printed rather than resolved silently.

## It is tested against its own repository

CI runs this action twice: once against `apps/demo`, which is built to break 31 rules and **must fail**, and once against `apps/demo/clean.html`, which must pass while still reporting the two rules it could not evaluate. An action only ever pointed at broken markup has never been tested for a false positive.
