/**
 * @marlo/cli
 *
 * `marlo scan` today. `marlo fix` when the repair layer lands, and the help text says so
 * rather than offering a flag that does nothing.
 */
export type { ScanOptions, ScanTarget } from './pipeline.js';
export { exitCodeFor, newRunId, scan } from './pipeline.js';
