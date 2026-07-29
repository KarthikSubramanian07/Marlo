# Changelog

Notable changes to Marlo. Kept to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioned with [semantic versioning](https://semver.org/spec/v2.0.0.html).

Two additions to the usual sections, because two kinds of change matter here more than a feature does:

**Accuracy** records every movement in a published number, with the direction stated plainly. A number getting worse is a changelog entry, not a silence.

**Coverage** records rules added or removed, always as a fraction with its denominator.

Nothing is published to a registry yet. There is no installable release, so there is nothing yet that could be depended on.

## [Unreleased]

### Added

- The research gate: `RESEARCH.md`, `PLAN.md`, `DECISIONS.md`, and the third-party licence ledger.
- Repository foundation: pnpm workspace, TypeScript in strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, ESLint, Prettier, dependency-cruiser rules that assert the architecture, pre-commit hooks that mirror CI.
- The forbidden-claims check. Fails the build if "certified", "guaranteed compliant", "fully accessible", "eliminates risk", or a hard-coded perfect score appears anywhere in the repository, including in generated output. There is no suppression comment.
- The prose check. No em dashes, no AI slop vocabulary.
- DCO sign-off enforcement, locally in a commit hook and in CI as a required status.
- Issue templates that route: false positive, false negative, new rule, calibration dispute, WCAG interpretation, bug. The false positive path is the shortest one in the repository, on purpose.
- Label taxonomy as committed configuration in `.github/labels.yml`, applied by `scripts/sync-labels.mjs`.

### Notes

- `trymarlo.pages.dev` is the canonical URL. `marlo.pages.dev` was taken: Cloudflare assigned a suffixed subdomain, which is not the documented target, so the project was recreated under the fallback name from the build brief.

[Unreleased]: https://github.com/KarthikSubramanian07/Marlo/commits/main
