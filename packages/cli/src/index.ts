/**
 * @trymarlo/cli
 *
 * `marlo scan` today. `marlo fix` when the repair layer lands, and the help text says so
 * rather than offering a flag that does nothing.
 */
export type { ScanOptions, ScanTarget } from './pipeline.js';
export { exitCodeFor, newRunId, scan } from './pipeline.js';
export type { ScanRenderer, TableChoice } from './table.js';
export {
  TABLE_BY_RENDERER,
  calibrationTableFor,
  describeTableChoice,
  locateTable,
  tableCandidates,
} from './table.js';
