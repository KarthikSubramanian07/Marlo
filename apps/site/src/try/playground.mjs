/**
 * The playground on /try/: paste HTML, see what Marlo's own engine says about it.
 *
 * The markup is written into an iframe with `sandbox="allow-same-origin"` and no
 * `allow-scripts`, so the page's own scripts never run and its forms cannot submit, while
 * this script, in the parent, can still read the laid-out document and its computed
 * styles. The page's content security policy has `connect-src 'none'`, and nothing here
 * makes a request: the markup never leaves the browser.
 */
import { META, evaluate, summarise } from './marlo.mjs';
import { highlight, renderResults } from './render.mjs';

const $ = (id) => document.getElementById(id);
const source = $('mt-source');
const frame = $('mt-frame');
const results = $('mt-results');
const status = $('mt-status');
const run = $('mt-run');
const download = $('mt-download');

let lastReport = null;
let undo = () => {};

/**
 * A pasted page's relative URLs would otherwise resolve against this site and request its
 * paths. A base on a reserved domain sends them nowhere: the policy blocks every origin
 * but this one, and .invalid never resolves.
 */
const BASE = '<base href="https://example.invalid/">';

/** After the doctype, so a page that declares one keeps standards mode. */
function withBase(html) {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype === null) return `${BASE}${html}`;
  return `${doctype[0]}${BASE}${html.slice(doctype[0].length)}`;
}

function loadFrame(html) {
  return new Promise((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.srcdoc = /<base\b/i.test(html) ? html : withBase(html);
  });
}

async function check() {
  const html = source.value;
  if (html.trim() === '') {
    status.textContent = 'Paste some HTML first, or pick an example.';
    source.focus();
    return;
  }
  run.disabled = true;
  status.textContent = 'Checking.';
  undo = () => {};
  try {
    await loadFrame(html);
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    if (doc === null || view === null) throw new Error('The preview frame is not readable.');
    const { report, durationMs } = evaluate(doc, view, 'https://example.invalid/pasted.html');
    lastReport = report;
    const summary = summarise(report);
    renderResults(results, summary, {
      durationMs,
      ruleHref: (id) => `https://act-rules.github.io/rules/${id}`,
      onSelect: (selector) => {
        undo();
        undo = highlight(doc, selector);
        frame.scrollIntoView({ block: 'nearest' });
      },
    });
    download.hidden = false;
    status.textContent =
      `Done. ${String(summary.findings)} failure${summary.findings === 1 ? '' : 's'} ` +
      `across ${String(summary.failed.length)} rule${summary.failed.length === 1 ? '' : 's'}.`;
  } catch (error) {
    status.textContent = `Marlo could not check this: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    run.disabled = false;
  }
}

run.addEventListener('click', () => {
  void check();
});

source.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void check();
  }
});

for (const button of document.querySelectorAll('[data-sample]')) {
  button.addEventListener('click', () => {
    const sample = META.samples[button.getAttribute('data-sample')];
    if (sample === undefined) return;
    source.value = sample.html;
    void check();
  });
}

download.addEventListener('click', () => {
  if (lastReport === null) return;
  const blob = new Blob([`${JSON.stringify(lastReport, null, 2)}\n`], {
    type: 'application/json',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'marlo-report.json';
  link.click();
  URL.revokeObjectURL(link.href);
});

run.disabled = false;
status.textContent = 'Ready. Nothing you paste leaves this browser.';
