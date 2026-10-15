/**
 * The bookmarklet panel's stylesheet, applied inside its shadow root.
 *
 * Self-contained: it cannot rely on the site's fonts or custom properties, because it runs
 * on somebody else's page. The palette is the site's, written out. `all: initial` on the
 * host stops the page's inherited styles leaking in.
 */
export const PANEL_CSS = `
:host { all: initial; }
.mt-panel {
  position: fixed; inset: 8px 8px 8px auto; z-index: 2147483647;
  width: min(440px, calc(100vw - 16px)); overflow: auto; box-sizing: border-box;
  padding: 16px 18px 20px; border: 1px solid #ffffff24; border-radius: 12px;
  background: #0c0c0e; color: #fafafa; color-scheme: dark;
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  box-shadow: 0 24px 64px #000000b3;
}
.mt-panel *, .mt-panel *::before, .mt-panel *::after { box-sizing: border-box; }
.mt-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mt-panel__head h2 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -0.01em; }
.mt-panel__head h2::before { content: ''; display: inline-block; width: 12px; height: 12px; margin-right: 8px; background: #c9f227; box-shadow: inset 0 0 0 4px #c9f227, inset 0 0 0 6px #0c0c0e; vertical-align: -1px; }
.mt-close { min-height: 32px; padding: 4px 12px; border: 1px solid #ffffff24; border-radius: 8px; background: transparent; color: #fafafa; font: inherit; cursor: pointer; }
.mt-close:hover { background: #ffffff14; }
.mt-close:focus-visible, .mt-verdict__target:focus-visible, .mt-panel summary:focus-visible, .mt-panel a:focus-visible { outline: 2px solid #c9f227; outline-offset: 2px; }
.mt-note { margin: 10px 0 4px; color: #a1a1aa; font-size: 13px; }
.mt-panel a { color: #dbfd5e; }
${'' /* Results, shared shape with the playground. */}
.mt-totals { margin: 12px 0; }
.mt-section { margin: 18px 0 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #a1a1aa; }
.mt-empty { margin: 0; color: #a1a1aa; }
.mt-rules, .mt-verdicts { margin: 0; padding: 0; list-style: none; }
.mt-rule { border: 1px solid #ffffff14; border-radius: 10px; background: #111113; }
.mt-rule + .mt-rule { margin-top: 8px; }
.mt-rule summary { display: block; padding: 10px 12px; cursor: pointer; list-style: none; }
.mt-rule summary::-webkit-details-marker { display: none; }
.mt-rule__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.mt-sev { font: 600 12px/1 ui-monospace, Menlo, monospace; white-space: nowrap; }
.mt-sev--critical, .mt-sev--serious { color: #ff8a8a; }
.mt-sev--moderate { color: #f5c26b; }
.mt-sev--advisory { color: #a1a1aa; }
.mt-rule__id { font: 12px ui-monospace, Menlo, monospace; color: #a1a1aa; }
.mt-rule__name { flex: 1 1 180px; font-weight: 550; }
.mt-rule__count { color: #a1a1aa; font-size: 13px; }
.mt-rule__meta { margin: 0 12px 8px; color: #a1a1aa; font-size: 13px; }
.mt-verdicts { padding: 0 12px 12px; }
.mt-verdict { padding: 8px 0; border-top: 1px solid #ffffff14; }
.mt-verdict__target { display: block; max-width: 100%; min-height: 28px; padding: 2px 6px; border: 1px solid #ffffff24; border-radius: 6px; background: #09090b; color: #dbfd5e; font: 12px ui-monospace, Menlo, monospace; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.mt-verdict__target code { font: inherit; }
.mt-verdict__message { margin: 6px 0 0; }
.mt-verdict__snippet { margin: 6px 0 0; padding: 8px; overflow: auto; border-radius: 6px; background: #09090b; color: #a1a1aa; font: 12px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
`;
