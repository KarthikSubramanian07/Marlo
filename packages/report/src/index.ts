/**
 * @marlo/report
 *
 * The four surfaces a finding can leave through: the terminal, a pull request body, SARIF,
 * and the JSON report itself.
 *
 * Two of them are what developers judge Marlo by, and both follow the same rule: what was
 * not examined is as prominent as what was found. "No contrast problems were found" and
 * "contrast was not examined" are different sentences, and no surface here blurs them.
 *
 * `invariant.ts` is the one-directional invariant, held at 100 percent coverage. An
 * uncovered branch in it is a path where Marlo reports clean while a peer engine reported a
 * failure.
 */

export type { RuleVerdict } from './invariant.js';
export { decideRule, invariantViolations } from './invariant.js';
export type { TerminalOptions } from './terminal.js';
export { coverageLine, renderTerminal, shouldUseColour } from './terminal.js';
export { pullRequestTitle, renderPullRequestBody } from './pull-request.js';
export { renderSarif } from './sarif.js';
