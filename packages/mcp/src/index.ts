/**
 * @marlo/mcp
 *
 * Marlo over the Model Context Protocol. Three tools, all read-only, and a list of the write
 * tools this server refuses on principle rather than for lack of implementation.
 *
 * The transport is JSON-RPC 2.0 over stdio, hand-written rather than taken from the official
 * SDK. Two reasons. The protocol surface this server needs is `initialize`, `tools/list` and
 * `tools/call`, which is under a hundred lines, and a dependency that opens a socket in a
 * package whose entire claim is that it cannot write anything is a dependency somebody has to
 * audit to believe the claim.
 */
export type { CallOptions, ToolDefinition, ToolResult } from './server.js';
export { TOOLS, callTool, loadTable, refusedTools, renderForModel } from './server.js';
export { serve } from './transport.js';
