/**
 * Marlo's own rules, run on a document in the visitor's browser.
 *
 * This is the same code `marlo scan --renderer browser` injects into Chromium, bundled for
 * the site: @trymarlo/rules is pure, so the bundle is the rules plus the two things only a
 * laid-out page supplies, resolved styles and border boxes. It is shared by the playground,
 * which runs it on markup pasted into a sandboxed frame, and the bookmarklet, which runs it
 * on the page the visitor is looking at.
 *
 * Only Marlo's own engine runs here. The CLI also runs axe-core, Alfa and HTML CodeSniffer,
 * routes each rule to the engine measured most precise, and refuses to report a rule clean
 * when any engine failed it. None of that happens in the browser, and every surface that
 * uses this module says so.
 */
import { buildDocument, evaluateRules, IMPLEMENTED_RULES } from '@trymarlo/rules';
import { META } from 'marlo:meta';

export { META };

/**
 * Evaluates every rule Marlo implements against `doc`, laid out in `view`.
 *
 * `view` is the window that owns the document. For the playground that is the sandboxed
 * frame's window, reached from the parent because the frame shares its origin and runs no
 * script of its own.
 */
export function evaluate(doc, view, url) {
  const root = doc.documentElement;
  if (root === null) throw new Error('The document has no root element.');
  const started = performance.now();
  const document = buildDocument(root, {
    url,
    hasDoctype: doc.doctype !== null,
    computedStyleFor: (element) => {
      const style = view.getComputedStyle(element);
      return { get: (property) => style.getPropertyValue(property) };
    },
    boxFor: (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x + view.scrollX,
        y: rect.y + view.scrollY,
        width: rect.width,
        height: rect.height,
      };
    },
  });
  const report = evaluateRules([...IMPLEMENTED_RULES], {
    document,
    renderer: 'browser',
    // No `script`: neither surface runs the page's scripts on Marlo's behalf, and no rule
    // Marlo implements needs them.
    capabilities: new Set(['dom', 'layout', 'paint']),
    version: META.version,
  });
  return { report, durationMs: Math.round(performance.now() - started) };
}

const RANK = { critical: 4, serious: 3, moderate: 2, advisory: 1 };

/**
 * Groups a report the way the CLI prints one: failures by severity, then what needs a
 * person, then what was not examined. A rule that was not examined is not a pass, and
 * the summary counts it separately for that reason.
 */
export function summarise(report) {
  const rule = (id) => META.rules[id] ?? { name: id, severity: 'moderate', criteria: [] };
  const failed = [];
  const cantTell = [];
  const notExamined = [];
  let passed = 0;
  let inapplicable = 0;
  for (const result of report.results) {
    const meta = { actRuleId: result.actRuleId, ...rule(result.actRuleId) };
    if (result.status !== 'ok') {
      notExamined.push({ ...meta, reason: result.error ?? result.missingCapabilities.join(', ') });
      continue;
    }
    const failures = result.verdicts.filter((v) => v.outcome === 'failed');
    const unsure = result.verdicts.filter((v) => v.outcome === 'cantTell');
    if (failures.length > 0) failed.push({ ...meta, verdicts: failures });
    if (unsure.length > 0) cantTell.push({ ...meta, verdicts: unsure });
    if (failures.length === 0 && unsure.length === 0) {
      if (result.verdicts.some((v) => v.outcome === 'passed')) passed += 1;
      else inapplicable += 1;
    }
  }
  const order = (a, b) =>
    RANK[b.severity] - RANK[a.severity] || b.verdicts.length - a.verdicts.length;
  failed.sort(order);
  cantTell.sort(order);
  return {
    failed,
    cantTell,
    notExamined,
    passed,
    inapplicable,
    findings: failed.reduce((n, r) => n + r.verdicts.length, 0),
  };
}

/** One line of measured confidence for a rule, or an honest absence of one. */
export function confidence(rule) {
  if (rule.precision === null || rule.testCases === 0) {
    return 'Not measured on the official test cases.';
  }
  return (
    `Marlo's own engine: precision ${rule.precision.toFixed(2)} over ` +
    `${String(rule.testCases)} official test cases, in a browser.`
  );
}
