/**
 * The playground on /try/: give it a web address, a GitHub repository or some HTML, and see
 * what Marlo's own engine says.
 *
 * Wherever the markup comes from, it is written into an iframe with
 * `sandbox="allow-same-origin"` and no `allow-scripts`, so the page's own scripts never run
 * and its forms cannot submit, while this script, in the parent, reads the laid-out document
 * and its computed styles. The rules run here, in the visitor's browser.
 *
 *   A web address goes to /try/fetch on this site, which returns that one page's HTML,
 *   because a browser may not read another site's HTML itself. DECISIONS.md D-015.
 *   A GitHub repository is read straight from GitHub's API and raw file host.
 *   Pasted HTML never leaves the page.
 *
 * The page's content security policy names exactly those destinations in connect-src.
 */
import { META, evaluate, summarise } from './marlo.mjs';
import { highlight, renderResults } from './render.mjs';
import {
  charsetOf,
  classifyInput,
  looksScriptRendered,
  pickHtmlFiles,
  withBase,
} from './sources.mjs';

const $ = (id) => document.getElementById(id);
const address = $('mt-url');
const addressForm = $('mt-url-form');
const source = $('mt-source');
const frame = $('mt-frame');
const results = $('mt-results');
const files = $('mt-files');
const status = $('mt-status');
const run = $('mt-run');
const go = $('mt-go');
const download = $('mt-download');

/** Where relative URLs in pasted markup go: a reserved domain that never resolves. */
const NOWHERE = 'https://example.invalid/';

let lastDownload = null;
let undo = () => {};
let busy = false;

function say(text) {
  status.textContent = text;
}

function setBusy(value) {
  busy = value;
  run.disabled = value;
  go.disabled = value;
}

function loadFrame(html) {
  return new Promise((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.srcdoc = html;
  });
}

const plural = (n, one, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

/** Loads markup into the frame, runs the rules, and returns the report and its summary. */
async function checkMarkup(html, { base, url }) {
  await loadFrame(withBase(html, base));
  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  if (doc === null || view === null) throw new Error('The preview frame is not readable.');
  const { report, durationMs } = evaluate(doc, view, url);
  return {
    report,
    durationMs,
    summary: summarise(report),
    scriptRendered: looksScriptRendered(html, doc.body?.innerText ?? ''),
  };
}

function show(outcome) {
  const doc = frame.contentDocument;
  renderResults(results, outcome.summary, {
    durationMs: outcome.durationMs,
    ruleHref: (id) => `https://act-rules.github.io/rules/${id}`,
    onSelect: (selector) => {
      undo();
      if (doc !== null) undo = highlight(doc, selector);
      frame.scrollIntoView({ block: 'nearest' });
    },
  });
}

function doneMessage(summary, where) {
  return (
    `${where}: ${plural(summary.findings, 'failure')} across ` +
    `${plural(summary.failed.length, 'rule')}.`
  );
}

const SCRIPT_RENDERED =
  ' This page builds itself with JavaScript and even a browser left little in it to check. ' +
  'Open the page and use the bookmarklet below, which sees it as your browser draws it.';

const VIA_BROWSER = {
  refused:
    ' The site refuses automated requests, so a real browser in Cloudflare loaded it instead.',
  rendered: ' The page builds itself with JavaScript, so a real browser loaded it first.',
};

async function checkPasted() {
  const html = source.value;
  if (html.trim() === '') {
    say('Paste some HTML first, or pick an example.');
    source.focus();
    return;
  }
  files.replaceChildren();
  const outcome = await checkMarkup(html, { base: NOWHERE, url: `${NOWHERE}pasted.html` });
  show(outcome);
  lastDownload = outcome.report;
  say(doneMessage(outcome.summary, 'Pasted HTML'));
}

async function readProblem(response) {
  try {
    const body = await response.json();
    return [body.detail, body.hint].filter(Boolean).join(' ');
  } catch {
    return `The fetch failed with status ${String(response.status)}.`;
  }
}

/** Fetches a page through /try/fetch, decoded with the charset the site declared. */
async function fetchPage(url, render) {
  const response = await fetch(
    `/try/fetch?url=${encodeURIComponent(url)}${render ? '&render=1' : ''}`,
  );
  if (!response.ok) return { error: await readProblem(response) };
  const bytes = await response.arrayBuffer();
  let html;
  try {
    html = new TextDecoder(charsetOf(response.headers.get('x-marlo-content-type'))).decode(bytes);
  } catch {
    html = new TextDecoder().decode(bytes);
  }
  return {
    html,
    finalUrl: response.headers.get('x-marlo-final-url') ?? url,
    via: response.headers.get('x-marlo-via') ?? 'fetch',
  };
}

async function checkUrl(url) {
  files.replaceChildren();
  say(`Fetching ${url}.`);
  let page = await fetchPage(url, false);
  if (page.error !== undefined) {
    say(page.error);
    return;
  }
  let note = page.via === 'browser' ? VIA_BROWSER.refused : '';
  say(`Checking ${page.finalUrl}.`);
  // The page's own URL as the base, so its stylesheets and images load in the preview and
  // the layout rules see it styled. Its scripts still do not run.
  let outcome = await checkMarkup(page.html, { base: page.finalUrl, url: page.finalUrl });
  if (outcome.scriptRendered && page.via !== 'browser') {
    say(`${page.finalUrl} builds itself with JavaScript. Loading it in a real browser.`);
    const rendered = await fetchPage(page.finalUrl, true);
    if (rendered.error === undefined) {
      page = rendered;
      note = VIA_BROWSER.rendered;
      outcome = await checkMarkup(page.html, { base: page.finalUrl, url: page.finalUrl });
    }
  }
  show(outcome);
  lastDownload = outcome.report;
  say(
    doneMessage(outcome.summary, page.finalUrl) +
      note +
      (outcome.scriptRendered ? SCRIPT_RENDERED : ''),
  );
}

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 403 || response.status === 429) {
    throw new Error('GitHub is rate limiting this browser for now. Try again in a few minutes.');
  }
  if (response.status === 404) {
    throw new Error('GitHub has no public repository, branch or folder at that address.');
  }
  if (!response.ok) throw new Error(`GitHub answered with status ${String(response.status)}.`);
  return response.json();
}

async function checkRepo({ owner, repo, ref, path }) {
  files.replaceChildren();
  say(`Reading ${owner}/${repo} from GitHub.`);
  const branch = ref ?? (await github(`/repos/${owner}/${repo}`)).default_branch;
  const tree = await github(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  const picked = pickHtmlFiles(tree.tree ?? [], path);
  if (picked.files.length === 0) {
    results.replaceChildren();
    say(
      `No HTML files in ${owner}/${repo}${path ? `/${path}` : ''}. A site built with a ` +
        'framework only has HTML after it is built: enter the deployed site’s address ' +
        'instead, or add the GitHub Action to the repository.',
    );
    return;
  }
  const checked = [];
  for (const [index, file] of picked.files.entries()) {
    say(`Checking ${file} (${String(index + 1)} of ${String(picked.files.length)}).`);
    const raw = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${file
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
    );
    if (!raw.ok) continue;
    const html = await raw.text();
    const folder = file.includes('/') ? `${file.slice(0, file.lastIndexOf('/'))}/` : '';
    // jsDelivr serves repository files with real content types, so stylesheets apply.
    const base = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${folder}`;
    const pageUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${file}`;
    const outcome = await checkMarkup(html, { base, url: pageUrl });
    checked.push({ file, html, base, pageUrl, outcome });
  }
  lastDownload = {
    repository: `${owner}/${repo}`,
    ref: branch,
    files: checked.map((c) => ({ path: c.file, report: c.outcome.report })),
  };
  renderFileList(checked, picked.total);
  const failing = checked.find((c) => c.outcome.summary.findings > 0) ?? checked[0];
  if (failing !== undefined) await select(failing);
  const total = checked.reduce((n, c) => n + c.outcome.summary.findings, 0);
  say(
    `${owner}/${repo}: ${plural(total, 'failure')} across ${plural(checked.length, 'HTML file')}` +
      (picked.total > checked.length
        ? `, the first ${String(checked.length)} of ${String(picked.total)}.`
        : '.'),
  );
}

async function select(entry) {
  await loadFrame(withBase(entry.html, entry.base));
  show(entry.outcome);
  for (const button of files.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.file === entry.file));
  }
}

function renderFileList(checked, total) {
  files.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'mt-section';
  heading.textContent =
    total > checked.length ? `Files, first ${String(checked.length)} of ${String(total)}` : 'Files';
  const list = document.createElement('ul');
  list.className = 'mt-files';
  for (const entry of checked) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mt-file';
    button.dataset.file = entry.file;
    button.setAttribute('aria-pressed', 'false');
    const name = document.createElement('code');
    name.textContent = entry.file;
    const count = document.createElement('span');
    count.className = 'mt-file__count';
    count.textContent = plural(entry.outcome.summary.findings, 'failure');
    button.append(name, count);
    button.addEventListener('click', () => {
      void select(entry);
    });
    item.append(button);
    list.append(item);
  }
  files.append(heading, list);
}

async function guarded(task) {
  if (busy) return;
  setBusy(true);
  undo = () => {};
  try {
    await task();
    download.hidden = lastDownload === null;
  } catch (error) {
    say(`Marlo could not check this: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(false);
  }
}

function checkAddress() {
  const input = classifyInput(address.value);
  if (input.kind === 'empty') {
    say('Enter a web address or a GitHub repository first.');
    address.focus();
    return;
  }
  if (input.kind === 'invalid') {
    say(input.reason);
    return;
  }
  if (input.kind === 'html') {
    source.value = address.value;
    address.value = '';
    $('mt-paste').open = true;
    void guarded(checkPasted);
    return;
  }
  void guarded(() => (input.kind === 'repo' ? checkRepo(input) : checkUrl(input.url)));
}

addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  checkAddress();
});

run.addEventListener('click', () => {
  void guarded(checkPasted);
});

source.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void guarded(checkPasted);
  }
});

for (const button of document.querySelectorAll('[data-address]')) {
  button.addEventListener('click', () => {
    address.value = button.getAttribute('data-address') ?? '';
    checkAddress();
  });
}

for (const button of document.querySelectorAll('[data-sample]')) {
  button.addEventListener('click', () => {
    const sample = META.samples[button.getAttribute('data-sample')];
    if (sample === undefined) return;
    source.value = sample.html;
    void guarded(checkPasted);
  });
}

download.addEventListener('click', () => {
  if (lastDownload === null) return;
  const blob = new Blob([`${JSON.stringify(lastDownload, null, 2)}\n`], {
    type: 'application/json',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'marlo-report.json';
  link.click();
  URL.revokeObjectURL(link.href);
});

setBusy(false);
say('Ready.');
