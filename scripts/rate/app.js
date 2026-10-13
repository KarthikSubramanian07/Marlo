/**
 * The rating interface, in the browser. It talks to scripts/rate.mjs and to nothing else:
 * GET /api/state for the worksheet, POST /api/answer to save one cell, and the snapshot
 * and source of the current page. The worksheet order is the server's, which is the
 * rater's seeded shuffle, and this file never sorts it.
 */

const ANSWERS = ['passed', 'failed', 'cantTell', 'inapplicable'];
const NOTE_REQUIRED = new Set(['failed', 'cantTell']);
const MAX_MATCHES = 2_000;

const $ = (id) => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  return element;
};

const ui = {
  raterLabel: $('rater-label'),
  progressText: $('progress-text'),
  progressBar: $('progress-bar'),
  pageId: $('page-id'),
  viewRendered: $('view-rendered'),
  viewSource: $('view-source'),
  snapshot: $('snapshot'),
  sourceView: $('source-view'),
  source: $('source'),
  search: $('search'),
  searchPrev: $('search-prev'),
  searchNext: $('search-next'),
  searchCount: $('search-count'),
  cell: $('cell'),
  position: $('position'),
  heading: $('cell-heading'),
  factPage: $('fact-page'),
  factCategory: $('fact-category'),
  ruleLink: $('rule-link'),
  factType: $('fact-type'),
  factRequirements: $('fact-requirements'),
  factAspects: $('fact-aspects'),
  prescreen: $('prescreen'),
  note: $('note'),
  noteError: $('note-error'),
  saveNote: $('save-note'),
  clearAnswer: $('clear-answer'),
  prev: $('prev'),
  next: $('next'),
  nextUnanswered: $('next-unanswered'),
  onlyUnanswered: $('only-unanswered'),
  autoAdvance: $('auto-advance'),
  status: $('status'),
  problems: $('problems'),
  problemsCount: $('problems-count'),
  problemsList: $('problems-list'),
  answerButtons: [...document.querySelectorAll('.answer')],
};

const state = {
  rater: '',
  cells: [],
  rules: {},
  pages: {},
  index: 0,
  /** An answer chosen that needs a note before it can be saved. */
  pending: null,
  view: 'rendered',
  loadedSnapshot: '',
  loadedSource: '',
  sourceText: '',
  matches: [],
  match: -1,
};

const current = () => state.cells[state.index];

function setStatus(message, bad = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('bad', bad);
}

function showNoteError(message) {
  ui.noteError.hidden = message === '';
  ui.noteError.textContent = message;
  ui.note.setAttribute('aria-invalid', message === '' ? 'false' : 'true');
}

function renderProgress(progress) {
  ui.progressText.textContent =
    `${String(progress.answered)} of ${String(progress.total)} cells answered ` +
    `(${String(progress.prefilled)} pre-filled by the pre-screen). ` +
    `${String(progress.remaining)} left.`;
  ui.progressBar.max = progress.total;
  ui.progressBar.value = progress.answered;
}

function renderProblems(problems, count) {
  ui.problems.hidden = count === 0;
  ui.problemsCount.textContent =
    count === 0
      ? ''
      : `${String(count)} problem(s) from the same check \`adjudicate.mjs validate\` runs.` +
        (count > problems.length ? ` The first ${String(problems.length)} are listed.` : '');
  ui.problemsList.replaceChildren(
    ...problems.map((p) => {
      const item = document.createElement('li');
      item.textContent = p;
      return item;
    }),
  );
}

function renderCell() {
  const cell = current();
  if (cell === undefined) return;
  const rule = state.rules[cell.rule] ?? {
    name: cell.ruleName,
    requirements: [],
    inputAspects: [],
  };
  const page = state.pages[cell.page] ?? { category: cell.category };
  ui.position.textContent = `${String(state.index + 1)} of ${String(state.cells.length)}`;
  ui.heading.textContent = rule.name;
  ui.pageId.textContent = cell.page;
  ui.factPage.textContent = cell.page;
  ui.factCategory.textContent = page.category;
  ui.ruleLink.textContent = cell.rule;
  ui.ruleLink.href = `https://act-rules.github.io/rules/${encodeURIComponent(cell.rule)}`;
  ui.ruleLink.setAttribute(
    'aria-label',
    `ACT rule ${cell.rule} on act-rules.github.io (opens a new tab)`,
  );
  ui.factType.textContent = rule.ruleType ? `, ${String(rule.ruleType)} rule` : '';
  ui.factRequirements.textContent =
    rule.requirements.length > 0 ? rule.requirements.join(', ') : 'none listed';
  ui.factAspects.textContent =
    rule.inputAspects.length > 0 ? rule.inputAspects.join(', ') : 'none listed';
  ui.snapshot.title = `Snapshot of ${cell.page}, ${String(page.category)}`;

  if (cell.prescreened) {
    ui.prescreen.hidden = false;
    ui.prescreen.textContent =
      cell.answer === 'inapplicable'
        ? 'Pre-filled inapplicable by the mechanical pre-screen: no element this rule applies to ' +
          'occurs anywhere in the page source. If that is wrong, give a different answer; the ' +
          'cell then counts as judged by you.'
        : 'The pre-screen suggested inapplicable here and you overrode it, so this cell counts ' +
          'as judged by you. Answer inapplicable to put the suggestion back.';
  } else {
    ui.prescreen.hidden = true;
  }

  for (const button of ui.answerButtons) {
    const answer = button.dataset.answer;
    button.setAttribute('aria-pressed', String(cell.answer === answer && state.pending === null));
    button.classList.toggle('pending', state.pending === answer);
    button.classList.toggle('prefilled', cell.prescreened && answer === 'inapplicable');
  }
  if (document.activeElement !== ui.note) ui.note.value = cell.note;
  showNoteError('');
  ui.clearAnswer.disabled = cell.answer === null;

  if (history.replaceState) history.replaceState(null, '', `#${String(state.index + 1)}`);
  loadPage(cell.page);
}

function loadPage(id) {
  if (state.view === 'rendered' && state.loadedSnapshot !== id) {
    state.loadedSnapshot = id;
    ui.snapshot.src = `/snapshot/${encodeURIComponent(id)}`;
  }
  if (state.view === 'source' && state.loadedSource !== id) {
    state.loadedSource = id;
    ui.source.textContent = 'Loading the source.';
    fetch(`/source/${encodeURIComponent(id)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        return response.text();
      })
      .then((text) => {
        if (state.loadedSource !== id) return;
        state.sourceText = text;
        ui.source.textContent = text;
        runSearch();
      })
      .catch((error) => {
        state.loadedSource = '';
        ui.source.textContent = `Could not load the source: ${String(error.message)}`;
      });
  }
}

function setView(view) {
  state.view = view;
  ui.viewRendered.setAttribute('aria-pressed', String(view === 'rendered'));
  ui.viewSource.setAttribute('aria-pressed', String(view === 'source'));
  ui.snapshot.hidden = view !== 'rendered';
  ui.sourceView.hidden = view !== 'source';
  const cell = current();
  if (cell !== undefined) loadPage(cell.page);
}

// Search in the source. The CSS Custom Highlight API marks matches without touching the
// text node, so a large page stays one node; where it is missing, the current match is
// selected instead.

function runSearch() {
  const query = ui.search.value.toLowerCase();
  state.matches = [];
  state.match = -1;
  const node = ui.source.firstChild;
  if (query !== '' && node !== null && state.sourceText !== '') {
    const haystack = state.sourceText.toLowerCase();
    let at = haystack.indexOf(query);
    while (at !== -1 && state.matches.length < MAX_MATCHES) {
      state.matches.push(at);
      at = haystack.indexOf(query, at + query.length);
    }
  }
  if (state.matches.length > 0) state.match = 0;
  paintMatches();
}

function rangeAt(offset) {
  const node = ui.source.firstChild;
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset + ui.search.value.length);
  return range;
}

function paintMatches() {
  const supported =
    typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
  if (supported) {
    CSS.highlights.delete('search-all');
    CSS.highlights.delete('search-current');
  }
  const total = state.matches.length;
  if (total === 0) {
    ui.searchCount.textContent = ui.search.value === '' ? '' : 'no matches';
    return;
  }
  ui.searchCount.textContent =
    `${String(state.match + 1)} of ${String(total)}` + (total >= MAX_MATCHES ? ' or more' : '');
  const currentRange = rangeAt(state.matches[state.match]);
  if (supported) {
    CSS.highlights.set('search-all', new Highlight(...state.matches.map((m) => rangeAt(m))));
    CSS.highlights.set('search-current', new Highlight(currentRange));
  } else {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(currentRange);
  }
  const box = currentRange.getBoundingClientRect();
  const frame = ui.source.getBoundingClientRect();
  ui.source.scrollTop += box.top - frame.top - frame.height / 3;
}

function stepMatch(delta) {
  const total = state.matches.length;
  if (total === 0) return;
  state.match = (state.match + delta + total) % total;
  paintMatches();
}

// Moving between cells. The order is the worksheet's; the filter only skips.

function findCell(from, delta, unansweredOnly) {
  const n = state.cells.length;
  for (let step = 1; step <= n; step += 1) {
    const i = from + delta * step;
    if (i < 0 || i >= n) return -1;
    if (!unansweredOnly || state.cells[i].answer === null) return i;
  }
  return -1;
}

function findUnanswered(from) {
  const n = state.cells.length;
  for (let step = 1; step <= n; step += 1) {
    const i = (from + step) % n;
    if (state.cells[i].answer === null) return i;
  }
  return -1;
}

async function leaveCell() {
  // A note typed but not saved is saved on the way out, when the answer allows it.
  const cell = current();
  if (cell === undefined) return true;
  if (state.pending !== null) {
    if (ui.note.value.trim() === '') {
      showNoteError(
        `A ${state.pending} answer needs a note before it is saved. Write one, or pick another answer.`,
      );
      ui.note.focus();
      return false;
    }
    return save(state.pending, ui.note.value);
  }
  if (ui.note.value !== cell.note && cell.answer !== null) return save(cell.answer, ui.note.value);
  return true;
}

async function goTo(index, { focusCell = false } = {}) {
  if (index < 0 || index >= state.cells.length) {
    setStatus('There is no cell in that direction with the current filter.');
    return;
  }
  if (!(await leaveCell())) return;
  state.index = index;
  state.pending = null;
  ui.note.value = current().note;
  renderCell();
  if (focusCell) ui.cell.focus();
}

const goNext = () => goTo(findCell(state.index, 1, ui.onlyUnanswered.checked));
const goPrev = () => goTo(findCell(state.index, -1, ui.onlyUnanswered.checked));
function goNextUnanswered() {
  const i = findUnanswered(state.index);
  if (i === -1) {
    setStatus('Every cell has an answer. Run node scripts/adjudicate.mjs validate to confirm.');
    return;
  }
  void goTo(i);
}

// Saving.

async function save(answer, note) {
  const cell = current();
  setStatus('Saving.');
  let response;
  let body;
  try {
    response = await fetch('/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: cell.page, rule: cell.rule, answer, note }),
    });
    body = await response.json();
  } catch (error) {
    setStatus(`Not saved: ${String(error.message)}. Is the server still running?`, true);
    return false;
  }
  if (!response.ok) {
    setStatus(`Not saved: ${String(body.error)}`, true);
    if (Array.isArray(body.problems)) showNoteError(body.problems.join(' '));
    return false;
  }
  state.cells[state.index] = body.cell;
  state.pending = null;
  renderProgress(body.progress);
  renderProblems(body.problems, body.problemCount);
  setStatus(
    answer === null
      ? `Cleared ${cell.page} by ${cell.rule}.`
      : `Saved ${answer} for ${cell.page} by ${cell.rule}.`,
  );
  renderCell();
  return true;
}

async function choose(answer) {
  const cell = current();
  if (cell === undefined) return;
  if (NOTE_REQUIRED.has(answer) && ui.note.value.trim() === '') {
    state.pending = answer;
    renderCell();
    showNoteError(`A ${answer} answer needs a note saying why: name the element and the reason.`);
    setStatus(`${answer} chosen, not saved yet: it needs a note.`);
    ui.note.focus();
    return;
  }
  const saved = await save(answer, ui.note.value);
  if (saved && ui.autoAdvance.checked) goNextOrStay();
}

function goNextOrStay() {
  const i = ui.onlyUnanswered.checked
    ? findUnanswered(state.index)
    : findCell(state.index, 1, false);
  // Leaving the note field on the way, so the single-key shortcuts work on the next cell.
  if (i !== -1) void goTo(i, { focusCell: document.activeElement === ui.note });
}

async function saveNote({ advance = false } = {}) {
  const cell = current();
  const answer = state.pending ?? cell.answer;
  if (answer === null) {
    showNoteError('Choose an answer first. The note is saved with it.');
    return;
  }
  if (NOTE_REQUIRED.has(answer) && ui.note.value.trim() === '') {
    showNoteError(`A ${answer} answer needs a note saying why.`);
    return;
  }
  const saved = await save(answer, ui.note.value);
  if (saved && advance) goNextOrStay();
}

// Wiring.

for (const button of ui.answerButtons) {
  button.addEventListener('click', () => void choose(button.dataset.answer));
}
ui.saveNote.addEventListener('click', () => void saveNote());
ui.clearAnswer.addEventListener('click', () => {
  ui.note.value = current().note;
  void save(null, current().note);
});
ui.prev.addEventListener('click', () => void goPrev());
ui.next.addEventListener('click', () => void goNext());
ui.nextUnanswered.addEventListener('click', goNextUnanswered);
ui.viewRendered.addEventListener('click', () => setView('rendered'));
ui.viewSource.addEventListener('click', () => setView('source'));
ui.search.addEventListener('input', runSearch);
ui.searchNext.addEventListener('click', () => stepMatch(1));
ui.searchPrev.addEventListener('click', () => stepMatch(-1));
ui.search.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    stepMatch(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape') {
    ui.search.blur();
  }
});
ui.note.addEventListener('input', () => {
  if (ui.note.value.trim() !== '') showNoteError('');
});
ui.note.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void saveNote({ advance: true });
  } else if (event.key === 'Escape') {
    ui.note.blur();
  }
});

const typing = (target) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (typing(event.target)) return;
  const key = event.key.toLowerCase();
  const answer = ANSWERS[Number(key) - 1];
  if (/^[1-4]$/.test(key) && answer !== undefined) {
    event.preventDefault();
    void choose(answer);
  } else if (key === 'j') {
    event.preventDefault();
    void goNext();
  } else if (key === 'k') {
    event.preventDefault();
    void goPrev();
  } else if (key === 'u') {
    event.preventDefault();
    goNextUnanswered();
  } else if (key === 'n') {
    event.preventDefault();
    ui.note.focus();
  } else if (key === 'v') {
    event.preventDefault();
    setView(state.view === 'rendered' ? 'source' : 'rendered');
  } else if (key === '/') {
    event.preventDefault();
    setView('source');
    ui.search.focus();
  }
});

async function start() {
  let body;
  try {
    const response = await fetch('/api/state');
    body = await response.json();
    if (!response.ok) throw new Error(String(body.error));
  } catch (error) {
    setStatus(`Could not load the worksheet: ${String(error.message)}`, true);
    return;
  }
  state.rater = body.rater;
  state.cells = body.cells;
  state.rules = body.rules;
  state.pages = body.pages;
  ui.raterLabel.textContent = `rater ${String(body.rater)}`;
  document.title = `Rater ${String(body.rater)}, Marlo rating`;
  renderProgress(body.progress);
  renderProblems(body.problems, body.problemCount);

  const fromHash = Number(location.hash.slice(1)) - 1;
  if (Number.isInteger(fromHash) && fromHash >= 0 && fromHash < state.cells.length) {
    state.index = fromHash;
  } else {
    const first = state.cells.findIndex((c) => c.answer === null);
    state.index = first === -1 ? 0 : first;
  }
  ui.note.value = current()?.note ?? '';
  renderCell();
}

void start();
