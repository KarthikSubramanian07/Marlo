import { createInterface } from 'node:readline';
import type { CallOptions } from './server.js';
import { TOOLS, callTool } from './server.js';

/**
 * JSON-RPC 2.0 over stdio, which is what an MCP client speaks.
 *
 * Hand-written rather than taken from the official SDK, and the reason is the same one that
 * shapes the rest of this package: a server whose claim is that it cannot write anything
 * should be small enough that somebody can read it and agree. Three methods, one framing
 * decision, no sockets.
 *
 * Newline-delimited JSON rather than the Content-Length framing the specification also
 * permits. It is what every client this was tested against sends, and it is the half that can
 * be diagnosed by piping a line in by hand.
 */

interface Request {
  readonly jsonrpc: '2.0';
  readonly id?: number | string | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = '2025-06-18';

/** Writes one response. Never `process.exit`, for the reason in HONESTY.md entry 2. */
function reply(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function ok(id: Request['id'], result: unknown): void {
  reply({ jsonrpc: '2.0', id: id ?? null, result });
}

function err(id: Request['id'], code: number, message: string): void {
  reply({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

/** Handles one parsed request. Exported so the tests can drive it without a pipe. */
export async function handle(request: Request, options: CallOptions): Promise<void> {
  switch (request.method) {
    case 'initialize':
      ok(request.id, {
        protocolVersion: PROTOCOL_VERSION,
        // No `resources`, no `prompts`, and no `sampling`. Declaring a capability this server
        // does not implement is the MCP equivalent of an option that does nothing.
        capabilities: { tools: {} },
        serverInfo: { name: 'marlo', version: options.marloVersion },
        instructions:
          'Every tool here is read-only. Marlo has no tool that writes a file, commits, ' +
          'merges, pushes or deploys, and will not gain one: repair arrives as a pull ' +
          'request a person approves. Before relaying a clean result to a person, call ' +
          'marlo_coverage and say what was not checked.',
      });
      return;

    // A notification, so it has no id and takes no reply.
    case 'notifications/initialized':
      return;

    case 'tools/list':
      ok(request.id, { tools: TOOLS });
      return;

    case 'tools/call': {
      const name = request.params?.['name'];
      if (typeof name !== 'string') {
        err(request.id, -32602, 'tools/call needs a string `name`');
        return;
      }
      const args = request.params?.['arguments'];
      const result = await callTool(
        name,
        typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
        options,
      );
      ok(request.id, result);
      return;
    }

    case 'ping':
      ok(request.id, {});
      return;

    default:
      err(request.id, -32601, `unsupported method: ${request.method}`);
  }
}

/** Reads newline-delimited JSON-RPC from stdin until it closes. */
export async function serve(options: CallOptions): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      err(null, -32700, 'parse error');
      continue;
    }
    try {
      await handle(request, options);
    } catch (error) {
      // A thrown tool is a bug in Marlo, and the client is entitled to the message rather
      // than a dropped connection.
      err(request.id, -32603, error instanceof Error ? error.message : String(error));
    }
  }
}
