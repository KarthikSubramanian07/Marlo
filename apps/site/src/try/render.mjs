/**
 * Renders a summarised report into a container, with DOM calls only.
 *
 * Every string a page supplies (selectors, snippets, messages quoting its text) goes in
 * through `textContent`, never markup, so a hostile page cannot inject into the panel that
 * reports on it. Severity is a text mark and a word, never colour alone, as in the CLI.
 */
import { confidence } from './marlo.mjs';

const MARK = { critical: '▲▲▲', serious: '▲▲', moderate: '▲', advisory: '···' };

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ruleBlock(doc, rule, kind, onSelect, ruleHref) {
  const item = el(doc, 'li', `mt-rule mt-rule--${kind}`);
  const details = el(doc, 'details');
  const summary = el(doc, 'summary');
  const head = el(doc, 'span', 'mt-rule__head');
  const severity = el(doc, 'span', `mt-sev mt-sev--${rule.severity}`);
  severity.append(
    el(doc, 'span', 'mt-sev__mark', MARK[rule.severity] ?? '▲'),
    el(doc, 'span', 'mt-sev__label', ` ${rule.severity}`),
  );
  head.append(
    severity,
    el(doc, 'code', 'mt-rule__id', rule.actRuleId),
    el(doc, 'span', 'mt-rule__name', rule.name),
    el(
      doc,
      'span',
      'mt-rule__count',
      `${String(rule.verdicts.length)} element${rule.verdicts.length === 1 ? '' : 's'}`,
    ),
  );
  summary.append(head);
  details.append(summary);

  const meta = el(doc, 'p', 'mt-rule__meta');
  if (rule.criteria.length > 0) meta.append(`WCAG ${rule.criteria.join(', ')}. `);
  meta.append(confidence(rule), ' ');
  const link = el(doc, 'a', null, 'The ACT rule');
  link.href = ruleHref(rule.actRuleId);
  link.target = '_blank';
  link.rel = 'noopener';
  meta.append(link);
  details.append(meta);

  const list = el(doc, 'ol', 'mt-verdicts');
  rule.verdicts.forEach((verdict, index) => {
    const row = el(doc, 'li', 'mt-verdict');
    const locate = el(doc, 'button', 'mt-verdict__target');
    locate.type = 'button';
    locate.append(el(doc, 'code', null, verdict.target.selector));
    locate.setAttribute(
      'aria-label',
      `Show element ${String(index + 1)} of ${String(rule.verdicts.length)} for rule ${rule.actRuleId}`,
    );
    locate.addEventListener('click', () => onSelect(verdict.target.selector));
    row.append(locate, el(doc, 'p', 'mt-verdict__message', verdict.message));
    if (verdict.target.snippet) {
      row.append(el(doc, 'pre', 'mt-verdict__snippet', verdict.target.snippet));
    }
    list.append(row);
  });
  details.append(list);
  item.append(details);
  return item;
}

/**
 * Fills `container` with the summary. `onSelect(selector)` is called when a reader asks
 * to see an element; `ruleHref(id)` gives the link for a rule.
 */
export function renderResults(container, summary, { onSelect, ruleHref, durationMs }) {
  const doc = container.ownerDocument;
  container.replaceChildren();

  const totals = el(doc, 'p', 'mt-totals');
  const count = (n, one, many) => `${String(n)} ${n === 1 ? one : many}`;
  totals.append(
    el(doc, 'strong', null, count(summary.findings, 'failure', 'failures')),
    ` across ${count(summary.failed.length, 'rule', 'rules')}. `,
    `${count(summary.cantTell.length, 'rule needs', 'rules need')} a person to decide. `,
    `${String(summary.passed)} passed, ${String(summary.inapplicable)} did not apply`,
    summary.notExamined.length > 0
      ? `, and ${String(summary.notExamined.length)} could not be examined.`
      : '.',
    durationMs === undefined ? '' : ` ${String(durationMs)} ms.`,
  );
  container.append(totals);

  const section = (title, rules, kind, empty) => {
    container.append(el(doc, 'h3', 'mt-section', title));
    if (rules.length === 0) {
      container.append(el(doc, 'p', 'mt-empty', empty));
      return;
    }
    const list = el(doc, 'ul', 'mt-rules');
    for (const rule of rules) list.append(ruleBlock(doc, rule, kind, onSelect, ruleHref));
    container.append(list);
  };
  section(
    'Failed',
    summary.failed,
    'failed',
    "No rule Marlo's engine evaluates failed. That is not the same as accessible.",
  );
  section(
    'Needs a person',
    summary.cantTell,
    'cant-tell',
    'Nothing here that Marlo could not decide.',
  );
  if (summary.notExamined.length > 0) {
    container.append(el(doc, 'h3', 'mt-section', 'Not examined'));
    const p = el(doc, 'p', 'mt-empty');
    p.textContent =
      `${summary.notExamined.map((r) => r.actRuleId).join(', ')}. ` +
      'This is not a pass: these rules did not run.';
    container.append(p);
  }
}

/** Outlines one element in `doc` and scrolls it into view; returns a function that undoes it. */
export function highlight(doc, selector) {
  let element = null;
  try {
    element = doc.querySelector(selector);
  } catch {
    // An XPath or otherwise unusual selector. Nothing to point at.
  }
  if (element === null) return () => {};
  const previous = element.getAttribute('style');
  element.style.setProperty('outline', '3px solid #f5a623', 'important');
  element.style.setProperty('outline-offset', '2px', 'important');
  element.scrollIntoView({ block: 'center', behavior: 'instant' });
  return () => {
    if (previous === null) element.removeAttribute('style');
    else element.setAttribute('style', previous);
  };
}
