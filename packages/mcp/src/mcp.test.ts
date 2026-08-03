import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CalibrationTable } from '@marlo/schema';
import { CalibrationTable as CalibrationTableSchema } from '@marlo/schema';
import { TOOLS, callTool, refusedTools } from './server.js';
import { handle } from './transport.js';

/**
 * The tests that matter here are the refusals.
 *
 * A read-only MCP server is a claim about a capability boundary, and a claim about a boundary
 * is worth what its tests are worth. So: no tool writes, the tool list contains nothing that
 * could, the source contains no filesystem write at all, and a model asking for a write tool
 * gets an explanation rather than a not-found.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const table: CalibrationTable = CalibrationTableSchema.parse(
  JSON.parse(readFileSync(resolve(ROOT, 'calibration/table.json'), 'utf8')),
);
const options = { table, marloVersion: '0.1.0' };

const textOf = (result: { content: readonly { text: string }[] }): string =>
  result.content.map((c) => c.text).join('\n');

describe('the capability boundary', () => {
  it('offers only tools that read', () => {
    for (const tool of TOOLS) {
      expect(tool.name.startsWith('marlo_')).toBe(true);
      expect(
        /fix|apply|write|commit|merge|push|deploy|delete|patch/.test(tool.name),
        `${tool.name} sounds like it writes something`,
      ).toBe(false);
    }
  });

  it('refuses every write tool by name, with the reason', async () => {
    for (const name of refusedTools()) {
      const result = await callTool(name, {}, options);
      expect(result.isError, `${name} should be refused`).toBe(true);
      const body = textOf(result);
      // Not a bare "unknown tool". A model that asked had a reasonable expectation, and the
      // useful answer is the boundary rather than a typo.
      expect(body.length, name).toBeGreaterThan(40);
      expect(body.toLowerCase()).toMatch(/pull request|not a capability|does not write/);
    }
  });

  it('names the refusals in the list a caller can read, not only in a switch', () => {
    expect(refusedTools()).toContain('marlo_fix');
    expect(refusedTools()).toContain('marlo_merge');
    expect(refusedTools()).toContain('marlo_deploy');
  });

  it('contains no filesystem write anywhere in the package', () => {
    // The strongest form of this test available without a sandbox: the capability is not
    // imported, so no tool can reach it however it is called.
    for (const file of ['server.ts', 'transport.ts', 'bin.ts', 'index.ts']) {
      const source = readFileSync(resolve(import.meta.dirname, file), 'utf8');
      for (const forbidden of [
        'writeFileSync',
        'appendFileSync',
        'createWriteStream',
        'rmSync',
        'unlinkSync',
        'mkdirSync',
        'execSync',
        'execFileSync',
        'spawnSync',
        'spawn(',
      ]) {
        expect(source.includes(forbidden), `${file} imports or calls ${forbidden}`).toBe(false);
      }
    }
  });

  it('declares no capability it does not implement', async () => {
    // An unimplemented capability in an initialize response is the MCP equivalent of an option
    // that does nothing, which is HONESTY.md entry 1.
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      written.push(chunk);
      return true;
    };
    try {
      await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, options);
    } finally {
      process.stdout.write = original;
    }
    const response = JSON.parse(written.join('')) as {
      result: { capabilities: Record<string, unknown>; instructions: string };
    };
    expect(Object.keys(response.result.capabilities)).toEqual(['tools']);
    expect(response.result.instructions).toContain('read-only');
  });
});

describe('what the tools return', () => {
  it('states coverage as a fraction with its denominator', async () => {
    const result = await callTool('marlo_coverage', {}, options);
    expect(textOf(result)).toContain('36 of 94');
    expect(result.isError).toBeFalsy();
  });

  it('tells a model that a clean result is not an accessible page', async () => {
    // The whole reason this server exists rather than a wrapper around axe-core. A model that
    // relays "no violations" to a person without this sentence has been misled by its tools.
    const result = await callTool('marlo_coverage', {}, options);
    expect(textOf(result)).toContain('minority of WCAG');
  });

  it('puts what was not evaluated above what was found', async () => {
    // A page with both: an unnamed button, which fails, and the contrast rules, which cannot
    // be evaluated at all on a renderer with no layout.
    const result = await callTool(
      'marlo_scan_html',
      {
        html: '<html lang="en"><head><title>t</title></head><body><button></button></body></html>',
      },
      options,
    );
    const body = textOf(result);
    const notEvaluated = body.indexOf('NOT EVALUATED');
    const findings = body.indexOf('finding(s).');
    expect(notEvaluated, 'contrast rules should be reported as not evaluated').toBeGreaterThan(-1);
    expect(findings, 'the unnamed button should be a finding').toBeGreaterThan(-1);
    expect(notEvaluated).toBeLessThan(findings);
  });

  it('never calls a page clean without qualifying it', async () => {
    const result = await callTool(
      'marlo_scan_html',
      { html: '<html lang="en"><head><title>t</title></head><body><p>hi</p></body></html>' },
      options,
    );
    const body = textOf(result);
    if (body.includes('No violations found')) {
      expect(body).toContain('not the same as an accessible page');
    }
  });

  it('attaches measured accuracy to a finding', async () => {
    const result = await callTool(
      'marlo_scan_html',
      { html: '<html><head></head><body><button></button></body></html>', label: 'Button.tsx' },
      options,
    );
    const body = textOf(result);
    expect(body).toContain('97a4e1');
    expect(body).toMatch(/precision \d\.\d\d over \d+ official test cases|not calibrated/);
  });

  it('explains a rule in both accuracy views', async () => {
    const result = await callTool('marlo_explain_rule', { actRuleId: 'c487ae' }, options);
    const body = textOf(result);
    expect(body).toContain('c487ae');
    expect(body).toContain('W3C verdict');
    expect(body).toContain('strict precision');
  });

  it('says so when the official protocol flatters an engine on a rule', async () => {
    const flattered = table.entries.find((e) => e.flatteredByProtocol);
    expect(flattered, 'the table should contain at least one flattered entry').toBeDefined();
    if (flattered === undefined) return;
    const result = await callTool(
      'marlo_explain_rule',
      { actRuleId: flattered.actRuleId },
      options,
    );
    expect(textOf(result)).toContain('FLATTERED');
  });

  it('rejects a rule identifier Marlo does not implement rather than scanning nothing', async () => {
    const result = await callTool(
      'marlo_scan_html',
      { html: '<html></html>', rules: ['zzzzzz'] },
      options,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('does not implement');
  });

  it('rejects an unpublished ACT identifier', async () => {
    const result = await callTool('marlo_explain_rule', { actRuleId: 'nope00' }, options);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not a published ACT rule');
  });

  it('rejects a scan with no html rather than scanning an empty string', async () => {
    for (const args of [{}, { html: '' }, { html: '   ' }, { html: 42 }]) {
      const result = await callTool('marlo_scan_html', args, options);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
  });

  it('answers an unknown tool by naming what it does offer', async () => {
    const result = await callTool('marlo_teleport', {}, options);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('marlo_scan_html');
  });
});

describe('the transport', () => {
  const drive = async (request: Record<string, unknown>): Promise<string> => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string) => {
      written.push(chunk);
      return true;
    };
    try {
      await handle(request as unknown as Parameters<typeof handle>[0], options);
    } finally {
      process.stdout.write = original;
    }
    return written.join('');
  };

  it('lists the tools', async () => {
    const raw = await drive({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const response = JSON.parse(raw) as { result: { tools: { name: string }[] } };
    expect(response.result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });

  it('answers ping', async () => {
    const raw = await drive({ jsonrpc: '2.0', id: 3, method: 'ping' });
    expect(JSON.parse(raw)).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
  });

  it('says nothing at all to a notification', async () => {
    expect(await drive({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe('');
  });

  it('returns a method-not-found error rather than closing the connection', async () => {
    const raw = await drive({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
    const response = JSON.parse(raw) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32601);
    expect(response.error.message).toContain('resources/list');
  });

  it('rejects a tools/call with no name', async () => {
    const raw = await drive({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} });
    const response = JSON.parse(raw) as { error: { code: number } };
    expect(response.error.code).toBe(-32602);
  });

  it('writes one line per response, because the framing is newline-delimited', async () => {
    const raw = await drive({ jsonrpc: '2.0', id: 6, method: 'tools/list' });
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.trimEnd().includes('\n')).toBe(false);
  });
});
