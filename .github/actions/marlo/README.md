# The Marlo Action

Checks changed HTML against the official ACT rules, with the measured accuracy of every finding attached. Read-only by default. With `open-pull-request: true` it also opens one pull request containing only the fixes it verified, with the evidence for each in the body.

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

In the default mode the only write it can perform is a pull request comment, which needs `pull-requests: write` and is off by default. The step prints which mode it checked.

## Opening a pull request, opt-in

```yaml
name: Accessibility repair
on: workflow_dispatch

permissions:
  contents: write # create the marlo/ branch and commit the fixes to it
  pull-requests: write # open the pull request

jobs:
  marlo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
      - run: pnpm install --frozen-lockfile && pnpm run build
      - uses: KarthikSubramanian07/Marlo/.github/actions/marlo@main
        with:
          open-pull-request: 'true'
```

What happens, in order:

1. The scope check requires exactly `contents: write` and `pull-requests: write`, and refuses the run under `contents: read`. It still refuses `workflows`, `administration`, `packages`, `pages`, `deployments` and `id-token` at any level.
2. `marlo fix --json` runs over the resolved files. It only ever produces a fix for a rule whose reporting engine clears the auto-fix gate (strict precision 0.95 over at least 6 decision-bearing official test cases), and only after re-rendering the page and re-running every engine.
3. A pure planner turns that report into one pull request. The branch is `marlo/fix-` followed by the first 12 hex characters of a sha256 over the sorted edits, so the same content always gets the same name. The body lists, per fix, the rule, its measured precision and sample size, the markup before and after, the three verification answers and the engines re-run, and per refusal the measurement or reason. It ends with the Marlo version and the calibration table's date and commit.
4. The GitHub client opens it over the REST API. It reads the default branch from the API and refuses to write to it, refuses a head equal to the base, never forces a ref update, and stops before its first write if the branch or an open pull request from it already exists. A second run over the same content opens nothing and edits nothing.

Caps, each a named constant in `packages/repair/src/pull-request.ts`: 200 files scanned, 50 fixes per pull request, 60 000 characters of body. Flags are cut from the body before any fix is, with the number cut stated. Two verified fixes that touch the same bytes in one file exclude that file, with a flag per fix. Files under `.github/` are never written.

The commit is authored as `marlo[bot] <marlo-bot@users.noreply.github.com>` unless you set `git-author-name` and `git-author-email`, and its message lists the rules fixed. A repository that requires a DCO sign-off or a human Author will fail that check on this commit; set the author inputs, or treat the pull request as a proposal to recreate by hand.

## Inputs

|                         |                                                    |                                                                                                        |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `files`                 | Space-separated paths                              | Default: HTML changed in the pull request, or all HTML on a push                                       |
| `renderer`              | `static` or `browser`                              | Default `static`. `browser` needs Playwright in the job and evaluates the layout-dependent rules       |
| `fail-on`               | `critical` `serious` `moderate` `advisory` `never` | Default `serious`                                                                                      |
| `fail-on-not-evaluated` | `true` or `false`                                  | Default `false`. The honest default on a renderer with no layout is to report the gap, not block on it |
| `sarif-file`            | Path                                               | Write SARIF 2.1.0, for the code scanning tab                                                           |
| `comment`               | `true` or `false`                                  | Default `false`. Needs `pull-requests: write`                                                          |
| `open-pull-request`     | `true` or `false`                                  | Default `false`. Needs exactly `contents: write` and `pull-requests: write`                            |
| `pull-request-base`     | Branch name                                        | Default: the repository's default branch, read from the API                                            |
| `git-author-name`       | Name                                               | Default `marlo[bot]`. Set together with `git-author-email`                                             |
| `git-author-email`      | Email                                              | Default `marlo-bot@users.noreply.github.com`                                                           |

## Outputs

`findings`, `not-evaluated`, `coverage`, `sarif`, and in the pull request mode `pull-request-url`, `fixes-applied` and `fixes-refused`.

`not-evaluated` is there so a workflow can react to the gap rather than only to the failures. A job that reports "0 findings" without mentioning that two rules were never evaluated is doing the thing this project was built to argue against.

## The report

What was not examined comes first, then the findings, then the provenance. Every surface Marlo has puts them in that order, and the reason is that "no contrast problems were found" and "contrast was not examined" are different sentences.

Findings carry the reporting engine and its precision on that rule over the official test cases, and a disagreement between engines is printed rather than resolved silently.

## It is tested against its own repository

CI runs this action twice: once against `apps/demo`, which is built to break 31 rules and **must fail**, and once against `apps/demo/clean.html`, which must pass while still reporting the two rules it could not evaluate. An action only ever pointed at broken markup has never been tested for a false positive.

Those CI runs are read-only. The pull request mode is exercised by `.github/workflows/dogfood-repair.yml`, dispatched by hand, and its refusal under `contents: read` is proved by `check-scopes.test.mjs` in this directory, which runs in `pnpm test`.
