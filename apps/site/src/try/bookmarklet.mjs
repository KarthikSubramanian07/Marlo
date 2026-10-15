/**
 * The bookmarklet: Marlo's own engine on the page you are looking at.
 *
 * Loaded by a bookmark as a script from trymarlo.pages.dev. It evaluates the live document
 * first and only then adds its panel, so the panel is never part of what it checks. The
 * panel sits in a closed shadow root, styled through a constructed stylesheet, so the
 * page's CSS cannot restyle it and it cannot restyle the page. It sends nothing anywhere.
 *
 * A page whose content security policy forbids scripts from other origins will refuse to
 * load this file. That is the page's policy working, and the playground on /try/ remains.
 */
import { evaluate, summarise } from './marlo.mjs';
import { highlight, renderResults } from './render.mjs';
import { PANEL_CSS } from './panel-css.mjs';

const HOST_ID = 'marlo-bookmarklet-panel';

function open() {
  document.getElementById(HOST_ID)?.remove();

  let outcome;
  try {
    outcome = evaluate(document, window, location.href);
  } catch (error) {
    window.alert(
      `Marlo could not check this page: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  const summary = summarise(outcome.report);

  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'closed' });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PANEL_CSS);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    root.append(style);
  }

  const panel = document.createElement('section');
  panel.className = 'mt-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', "Marlo's findings on this page");

  const header = document.createElement('header');
  header.className = 'mt-panel__head';
  const title = document.createElement('h2');
  title.textContent = 'marlo';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'mt-close';
  close.textContent = 'Close';
  header.append(title, close);

  const note = document.createElement('p');
  note.className = 'mt-note';
  note.textContent =
    "Marlo's own engine only. The CLI also runs axe-core, Alfa and HTML CodeSniffer and " +
    'will not report a rule clean when any of them failed it.';

  const body = document.createElement('div');
  body.className = 'mt-body';
  let undo = () => {};
  renderResults(body, summary, {
    durationMs: outcome.durationMs,
    ruleHref: (id) => `https://act-rules.github.io/rules/${id}`,
    onSelect: (selector) => {
      undo();
      undo = highlight(document, selector);
    },
  });

  panel.append(header, note, body);
  root.append(panel);
  document.documentElement.append(host);

  const dismiss = () => {
    undo();
    host.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') dismiss();
  };
  close.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey, true);
  close.focus();
}

open();
