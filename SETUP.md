# Setup

Brutally short, as promised.

## To run it

```bash
pnpm install
pnpm check
```

That is all. No API keys, no browser download, no network after install, no database. If any of that is untrue it is a bug worth an issue.

## To regenerate the accuracy table

```bash
pnpm calibrate          # about three minutes, 164 engine-rule measurements
pnpm calibrate:check    # what CI runs
```

## To work on the site

```bash
pnpm site:build         # generates apps/site/dist from calibration/table.json
pnpm screenshots        # needs Playwright, see below
```

## Optional: the browser renderer and screenshots

Only needed for layout-dependent rules and for capturing the site.

```bash
pnpm add -D playwright
pnpm exec playwright install chromium
```

Without it, layout-dependent rules report as **not evaluated** rather than passing, which is the honest degradation.

## To deploy the site

```bash
pnpm deploy
```

Requires `wrangler` to be authenticated once:

```bash
pnpm exec wrangler login
```

The Pages project is `trymarlo`, already created, serving [trymarlo.pages.dev](https://trymarlo.pages.dev).

## Manual steps that remain

Exactly four, and all of them are things a person has to decide rather than a script.

1. **Branch protection on `main`.** Required checks, required review, linear history, no force push. Settings → Branches, or `gh api`. Not enabled by the build, because enabling required review while merging the initial stack would have blocked the merge.
2. **`marlo.pages.dev` was taken.** Cloudflare assigned a suffixed subdomain, so the documented fallback `trymarlo.pages.dev` is used consistently everywhere. If you acquire the shorter name, it appears in `apps/site/src/build.mjs` (`ORIGIN`), `README.md`, `package.json` and `SECURITY.md`.
3. **Publishing to npm.** Nothing is published. `pnpm -r publish` when you want it, and note the brief's instruction that a public release should not be tagged without asking.
4. **A language provider, if you ever want generated alt text.** `ANTHROPIC_API_KEY` plus `MARLO_LANGUAGE_PROVIDER=anthropic`. The default is a deterministic stub and there is no fallback that quietly upgrades to a network call.

## Environment variables

All optional. Defaults are in `packages/schema/src/config.ts`, and `process.env` is a lint error outside that file so a required key cannot be introduced without appearing here.

|                               |                                                              |
| ----------------------------- | ------------------------------------------------------------ |
| `MARLO_RENDERER`              | `static` (default) or `browser`                              |
| `MARLO_ENGINES`               | Comma-separated. Default: all four                           |
| `MARLO_LOG_LEVEL`             | `silent`, `error`, `warn`, `info` (default), `debug`         |
| `MARLO_FAIL_ON_NOT_EVALUATED` | Exit 3 when a rule could not be evaluated                    |
| `MARLO_MIN_STRICT_PRECISION`  | Auto-fix threshold. Default `0.95`                           |
| `MARLO_MIN_SAMPLE_SIZE`       | Auto-fix sample floor. Default `6`                           |
| `MARLO_LANGUAGE_PROVIDER`     | `stub` (default) or `anthropic`                              |
| `ANTHROPIC_API_KEY`           | Only read when the provider is not `stub`                    |
| `NO_COLOR`                    | Honoured. Severity is never colour alone, so nothing is lost |
