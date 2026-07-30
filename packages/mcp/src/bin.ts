#!/usr/bin/env node
/**
 * `marlo-mcp`. Reads JSON-RPC on stdin, writes it on stdout, and never writes anything else.
 *
 * Nothing is logged to stdout, ever: stdout is the protocol channel and a stray console.log
 * corrupts the stream. Diagnostics go to stderr.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTable } from './server.js';
import { serve } from './transport.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

function version(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write(
    [
      'marlo-mcp: Marlo over the Model Context Protocol, on stdio.',
      '',
      'Every tool is read-only. There is no fix tool, no tool that writes a file, and no',
      'tool that commits, merges, pushes or deploys. That is a design boundary rather than',
      'an unfinished feature: repair arrives as a pull request a person approves.',
      '',
      'Add to a client config as:',
      '  { "command": "marlo-mcp" }',
      '',
      `Version ${version()}. Needs calibration/table.json, which is committed.`,
      '',
    ].join('\n'),
  );
} else {
  try {
    const table = loadTable(ROOT);
    await serve({ table, marloVersion: version() });
  } catch (error) {
    process.stderr.write(`marlo-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
