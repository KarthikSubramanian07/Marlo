# Security

Written to be evaluable by an institutional security review rather than to reassure a reader. If something here is vague, that is a defect and worth reporting as one.

---

## Reporting a vulnerability

**Do not open a public issue.**

Use [GitHub private vulnerability reporting](https://github.com/KarthikSubramanian07/Marlo/security/advisories/new), which is enabled on this repository, or email **karthik@tryclear.app** with `MARLO SECURITY` in the subject.

|                              |                                                    |
| ---------------------------- | -------------------------------------------------- |
| Acknowledgement              | Within 3 working days                              |
| Initial assessment           | Within 7 working days                              |
| Fix or documented mitigation | Within 30 days for high and critical               |
| Disclosure                   | Coordinated. Credit given unless you ask otherwise |

This is a small project. If the timeline slips you will be told it slipped rather than left waiting.

### In scope

The pipeline, the CLI, the MCP server, the GitHub Action, the published packages, the site, and the calibration artifacts. **A way to make Marlo report a fix as verified when it is not is a security issue, not a correctness issue**, because the entire product is a claim about verification and a forged verification is a privilege escalation against the person trusting it.

### Out of scope

Vulnerabilities in axe-core, Alfa, or HTML CodeSniffer belong upstream, though telling us as well is appreciated because we need to pin around them. Findings that require the reporter to already control the machine running Marlo. Missing hardening headers on `trymarlo.pages.dev` that have no exploit path, though a pull request adding one is welcome.

---

## What Marlo is allowed to do, and what it cannot do

This is the safety boundary from [D-011](DECISIONS.md#d-011). It is asserted in tests, not described in prose and hoped for.

**Marlo opens pull requests. Marlo does not:**

| Forbidden                           | Why it matters                                                   | How it is prevented                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Merge a pull request                | A tool that merges its own diffs has no reviewer                 | No merge API call exists in the codebase, and a test fails if one appears                                 |
| Push to a default branch            | The reason branch protection exists                              | Every write goes through a generated branch named `marlo/fix-<12 hex>`, and the default branch is refused |
| Force push                          | Destroys history someone may be relying on                       | The one ref update is sent with `force: false`, and the client runs no git command                        |
| Rewrite history                     | Same                                                             | No rebase, amend, or filter operation is reachable                                                        |
| Deploy                              | Marlo is not in the release path                                 | No deployment credential is ever requested                                                                |
| Modify workflow files               | A tool that can edit CI can disable the check that constrains it | The planner refuses any path under `.github/`, and the token never holds `workflows`                      |
| Edit files outside the target paths | Scope creep with write access                                    | Every edit is a byte range in a file the caller passed in, validated against the caller's path allow-list |

The tests asserting this are `packages/repair/src/github.test.ts`, which reads the repair package for any merge, force, delete or shell call and checks the client exposes no method that could make one, and `packages/repair/src/pull-request.test.ts`, which checks the planner refuses `.github/` and paths outside the repository.

### Token scopes, one at a time with the reason

The GitHub Action requests the minimum for each mode. Nothing is requested "just in case".

The Action's first step, `check-scopes.mjs`, reads the token's permissions and refuses to run if they do not match the mode, and prints which mode it checked. Where the runner does not expose the permissions, it says they were not checked rather than reporting a pass.

| Scope             | Report only, the default                       | `open-pull-request: true`                             |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `contents`        | `read`. `write` is refused                     | `write`, required: create the branch and commit to it |
| `pull-requests`   | `write` only if `comment: true`, else optional | `write`, required: open the pull request              |
| `security-events` | `write` only if you upload the SARIF           | Same                                                  |
| `workflows`       | Refused                                        | Refused                                               |
| `administration`  | Refused                                        | Refused                                               |
| `packages`        | Refused                                        | Refused                                               |
| `pages`           | Refused                                        | Refused                                               |
| `deployments`     | Refused                                        | Refused                                               |
| `id-token`        | Refused                                        | Refused                                               |

In the default mode `pull-requests: write` is the only write scope and it exists solely to comment. It does not permit merging: merge requires `contents: write` on the base branch, which is not granted.

In the pull request mode `contents: write` is what makes people uncomfortable and they are right to look closely. It is the scope that allows creating a branch and writing a commit to it. It also technically allows pushing to `main`, which is why:

1. The client in `packages/repair/src/github.ts` refuses any ref that is not under `refs/heads/marlo/`, reads the default branch from the API and refuses to write to it, refuses a head equal to the base, and sends its one ref update with `force: false`. Each is asserted in tests against an in-memory fake and a recorded `fetch`.
2. Enable branch protection on the default branch before turning the mode on. The Action does not check for it, so this one is on you.
3. The mode is off unless `open-pull-request: true` is set explicitly. There is no way to arrive at it by default or by upgrade, and `check-scopes.test.mjs` proves the Action refuses it under `contents: read`.

**Never requested, in any mode:** `actions: write`, `workflows`, `administration`, `packages`, `pages`, `deployments`, `id-token`, or any organisation scope.

### Fork pull requests

No secret is reachable from a fork pull request. The workflows that need credentials run on `pull_request_target` with an explicit checkout of the base ref and no execution of fork code, or they do not run on forks at all. Preview deploys for fork pull requests are built without secrets and deployed by a separate job gated on the base repository.

---

## Data flow, and what is retained

The short version: **Marlo prefers to process in flight and retains nothing by default.** The long version, because "we take your privacy seriously" is not an answer to a security questionnaire.

### The CLI, the library, and the MCP server

Everything happens in the caller's process, on the caller's machine.

|                      |                                                                            |
| -------------------- | -------------------------------------------------------------------------- |
| Source read          | Only paths the caller passed as arguments                                  |
| Network egress       | **None.** No telemetry, no analytics, no version check, no crash reporting |
| Written to disk      | Only the report path the caller asked for, and only if they asked          |
| Retained after exit  | Nothing. The process holds source in memory and exits                      |
| Third-party services | None. There is no API key to configure because there is nothing to call    |

Verifiable rather than asserted: `pnpm test` passes with no network. If Marlo phoned anywhere, that suite would need it to.

Cached artifacts, if the caller enables caching, are keyed by content hash and written under the caller's chosen cache directory. Nothing is written outside it.

### The GitHub Action

Runs in the caller's own runner, inside their own repository, under a token their repository issued.

|                |                                                                               |
| -------------- | ----------------------------------------------------------------------------- |
| Source seen    | The checkout the workflow already made                                        |
| Egress         | The GitHub API of the repository it is running in, and nothing else           |
| Retained by us | Nothing. There is no "us" in the data path                                    |
| Logs           | Written to the caller's Actions log, which the caller controls and can redact |

Findings contain source excerpts, so the Action's comment will include markup from the repository. On a private repository that comment is as private as the repository. Marlo does not transmit those excerpts anywhere else.

### The site, `trymarlo.pages.dev`

Static pages plus one Worker that serves calibration data.

|                      |                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Accepts user content | **Never on the server.** No upload and no scan-a-URL form. See the playground, below          |
| Cookies              | None                                                                                          |
| Analytics            | Cloudflare Web Analytics if enabled, which is cookieless and stores no per-visitor identifier |
| Personal data stored | None                                                                                          |
| Database contents    | Calibration history only, which is a projection of committed files in `calibration/`          |

**The playground and the bookmarklet.** `/try/` is the one page that serves a script, and the script is Marlo's own rules. Markup pasted there is written into an iframe with `sandbox="allow-same-origin"` and no `allow-scripts`, so its scripts never run and its forms cannot submit, and it is evaluated in the visitor's browser. The page's policy is `connect-src 'none'` and allows script from the site's own origin only, so neither the playground nor anything pasted into it can send a request; its one permitted base URL is on `.invalid`, which never resolves, so relative URLs in pasted markup go nowhere. The bookmarklet loads the same rules into whatever page the visitor opens, evaluates it there, and makes no request of its own. Its panel is built with DOM calls and `textContent` inside a closed shadow root, so text from the page cannot inject markup into it. A site test fails if either script contains a timer or any request API.

The absence of a hosted scanner is a deliberate architectural choice rather than a missing feature. A hosted scanner means accepting arbitrary URLs, rendering them in a browser we operate, and becoming a request-forgery surface and an abuse vector. It is also the component that would cost money, per [D-007](DECISIONS.md#d-007). Both reasons point the same way.

### The one place a model could be involved

Generated natural language sits behind an adapter with a deterministic stub as the default. With no API key configured, Marlo boots, the demo path works against fixtures, and the whole suite is green, because the stub is what runs.

If a caller configures a real provider, they are sending page content to that provider, and that is their decision to document in their own review. Marlo makes it visible rather than convenient:

- The default is the stub. There is no fallback that quietly upgrades to a network call.
- Every request is cached by content hash, so the same content is not sent twice.
- Output is reviewable before it lands, and it lands as a diff a human approves.
- Per [D-009](DECISIONS.md#d-009), the only text Marlo will generate at all is a description the page itself already supplies. If the page does not supply the meaning, Marlo flags it instead, so the amount of content that ever reaches a provider is bounded by that policy rather than by the size of the page.

---

## Engineering controls

**Input validation.** Every trust boundary parses with Zod rather than casting. Engine output, calibration table on load, MCP tool arguments, Action inputs, CLI config file. In `packages/schema`, `as` assertions are a lint error, because a boundary that casts instead of parsing is the exact failure Zod is there to prevent.

**Path handling.** Every file operation resolves against an explicit root and rejects the result if it escapes. Traversal is a rejected path, not a sanitised one.

**Injection.** No SQL is constructed by concatenation. The one database is D1, accessed with parameterised statements, and it holds only calibration history rebuildable from committed files.

**Output escaping.** The site is generated, and every interpolation into HTML goes through an escape function. The PR body is Markdown rendered by GitHub, and source excerpts are placed in fenced code blocks with the fence length computed from the content so an excerpt cannot break out of its own block.

**Untrusted markup.** Marlo's whole job is parsing hostile HTML. Parsing happens in happy-dom in-process with no script execution enabled by default; the browser renderer runs Chromium with JavaScript enabled, which is the point of it, and that is why it is opt-in and why the default renderer is the one that does not.

**Secret hygiene.** No secret is committed. `process.env` is a lint error outside the validated config module, so a required key cannot be introduced without appearing in `SETUP.md`. Secret scanning and push protection are enabled on the repository.

**Supply chain.** Committed lockfile. Third-party GitHub Actions pinned to full commit SHAs, never to a tag, because a tag is mutable and a compromised action runs with the workflow's permissions. Least-privilege `permissions:` on every workflow. Dependency review on pull requests. Grouped automated updates. `pnpm licenses:check` fails on a production dependency that is not in [docs/licenses.md](docs/licenses.md).

**Structured logging.** JSON with a correlation id per run, propagated through every stage so a finding can be traced to the render that produced it. Source excerpts in logs are truncated. The log level defaults to a level that does not emit page content.

**Rate limiting.** The Worker sits behind middleware with the limiter injected, so a deployment can enforce a limit without a code change. Cloudflare's own rate limiting is the outer layer.

---

## Supported versions

Pre-1.0. The latest minor receives security fixes. Once 1.0 ships, the current major and the previous major for six months after it is superseded.

There is no release published to a registry yet, so there is nothing installed to be vulnerable. [CHANGELOG.md](CHANGELOG.md) records the state.

---

## Threat model, briefly

What Marlo is worth attacking for, so you can judge whether the controls match.

**A forged verification.** The highest-value attack: make Marlo report a fix as verified when the criterion is still failing. That is why verification re-runs the full engine set on the re-rendered result rather than trusting the codemod, why `Fix` has no state meaning "claimed", and why this is classified as a security issue rather than a bug.

**A poisoned calibration table.** Change the numbers and every downstream confidence score is wrong in a direction of the attacker's choosing. Mitigated by the table being committed, regenerated deterministically in CI from a digest-verified corpus, and diffed on every pull request. Editing `calibration/table.json` by hand produces a CI failure, not a merge.

**A malicious rule or fixture.** A contributed rule is code that runs in a contributor's CI and on a user's machine. Mitigated by review, by rules being pure functions with no I/O enforced by dependency rules, and by the fixture corpus being digest-verified so a fixture cannot be quietly altered to make a bad rule look good.

**A hostile page attacking the scanner.** Marlo parses markup it did not write. Mitigated by parsing without script execution on the default path, and by the browser path being opt-in and sandboxed by Chromium.
