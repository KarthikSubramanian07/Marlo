# Accessibility

Marlo's marketing site and in-browser playground target **WCAG 2.2 Level AA**.

## How it is tested

- Automated: axe-core with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` at 1440×900, 390×844 and 320×800 on every published route, the try playground (paste panel open and sample findings), and the 404 page.
- Manual: skip link and landmarks, keyboard reach into scrollable code examples and snippet regions, focus order and visible focus, the bookmarklet findings dialog (Escape, focus trap and restore), live status on `/try/`, `lang` and page titles, and `prefers-reduced-motion`.

## Known limitations

- Colour-contrast incompletes from axe on dense calibration tables are not treated as failures when the published tokens already meet 4.5:1; table cells that scroll sideways stay inside a labelled, focusable region rather than reflowing every column at 320 px.
- The bookmarklet dialog is audited from its source and the built panel script; injecting it onto third-party pages with hostile CSP was not part of this pass.

## Reporting a barrier

Open a GitHub issue or use the contact page. Security-sensitive reports belong in private vulnerability reporting (see `SECURITY.md`).
