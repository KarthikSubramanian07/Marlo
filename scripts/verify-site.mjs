#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const origin = process.argv[2];
if (!origin || !URL.canParse(origin))
  throw new Error('Usage: node scripts/verify-site.mjs https://trymarlo.pages.dev');
const table = JSON.parse(
  readFileSync(new URL('../calibration/table.json', import.meta.url), 'utf8'),
);
const manifest = JSON.parse(
  readFileSync(new URL('../corpus/act/MANIFEST.json', import.meta.url), 'utf8'),
);
let checked = 0;
async function fetchResource(path, options = {}) {
  const response = await fetch(new URL(path, origin), {
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  checked += 1;
  assert.ok(
    response.headers.get('x-content-type-options') === 'nosniff',
    `${path}: security headers`,
  );
  return response;
}
async function json(path, status = 200) {
  const response = await fetchResource(path);
  assert.equal(response.status, status, path);
  assert.match(response.headers.get('content-type') ?? '', /application\/(?:problem\+)?json/, path);
  return response.json();
}
const sitemapResponse = await fetchResource('/sitemap.xml');
assert.equal(sitemapResponse.status, 200);
const sitemap = await sitemapResponse.text();
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  (match) => new URL(match[1]).pathname,
);
assert.ok(
  paths.includes('/developers/') && paths.includes('/docs/') && paths.includes('/privacy/'),
);
for (const path of paths) {
  for (const accept of ['text/markdown', 'text/html']) {
    const response = await fetchResource(path, { headers: { Accept: accept } });
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type')?.startsWith(accept), `${path}: ${accept}`);
    assert.match(response.headers.get('vary') ?? '', /(?:^|,\s*)Accept(?:,|$)/i, path);
    const body = await response.text();
    assert.ok(body.length > 20, path);
    assert.ok(
      accept === 'text/html' ? body.includes('<!doctype html>') : body.includes('# '),
      path,
    );
  }
  const markdown = await fetchResource(`${path}index.md`);
  assert.equal(markdown.status, 200);
  assert.ok(markdown.headers.get('content-type')?.startsWith('text/markdown'));
}
for (const path of ['/does-not-exist', '/nested/resource-not-published', '/unknown.json']) {
  const response = await fetchResource(path, { headers: { Accept: 'text/markdown' } });
  assert.equal(response.status, 404, path);
  assert.ok(response.headers.get('content-type')?.startsWith('text/markdown'));
  assert.match(await response.text(), /llms\.txt/);
}
const llmsResponse = await fetchResource('/llms.txt');
assert.equal(llmsResponse.status, 200);
const llms = await llmsResponse.text();
assert.match(llms, /^# Marlo\n\n> /);
assert.match(llms, /When to use:/);
for (const match of llms.matchAll(/\]\((https:\/\/[^)]+)\)/g)) {
  const url = new URL(match[1]);
  if (url.origin !== 'https://trymarlo.pages.dev') continue;
  assert.equal((await fetchResource(url.pathname)).status, 200, url.pathname);
}
const full = await fetchResource('/llms-full.txt');
assert.equal(full.status, 200);
assert.ok((await full.text()).includes('Marlo API and CLI documentation'));
const robots = await fetchResource('/robots.txt');
assert.equal(robots.status, 200);
assert.match(await robots.text(), /Sitemap: https:\/\/trymarlo\.pages\.dev\/sitemap\.xml/);
const spec = await json('/openapi.json');
assert.equal(spec.openapi, '3.1.0');
assert.equal(
  new Set(Object.values(spec.paths).map((path) => path.get.operationId)).size,
  Object.keys(spec.paths).length,
);
const coverage = await json('/api/v1/coverage');
assert.deepEqual(coverage.coverage, table.coverage);
const rules = await json('/api/v1/rules');
assert.equal(rules.rules.length, manifest.rules.length);
assert.deepEqual(await json('/api/v1/calibration'), table);
for (const rule of rules.rules) assert.deepEqual(await json(`/api/v1/rules/${rule.id}`), rule);
for (const [path, status] of [
  ['/api/v1/unknown', 404],
  ['/api/v1/rules/zzzzzz', 404],
  ['/api/v1/rules/invalid', 400],
]) {
  const error = await json(path, status);
  assert.equal(error.status, status);
  assert.ok(error.code && error.hint && error.docs);
}
const discovery = await json('/.well-known/mcp');
assert.equal(discovery.endpoint, 'https://trymarlo.pages.dev/mcp');
async function rpc(message) {
  const response = await fetchResource('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify(message),
  });
  return response;
}
const initialize = await rpc({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'marlo-verifier', version: '1.0.0' },
  },
});
assert.equal(initialize.status, 200);
assert.equal((await initialize.json()).result.protocolVersion, '2025-11-25');
assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
const tools = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
assert.deepEqual(
  tools.result.tools.map((tool) => tool.name),
  discovery.tools,
);
for (const [name, args] of [
  ['marlo_coverage', {}],
  ['marlo_list_rules', {}],
  ['marlo_explain_rule', { actRuleId: 'c487ae' }],
]) {
  const result = await (
    await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } })
  ).json();
  assert.equal(result.result.isError, false);
  assert.deepEqual(JSON.parse(result.result.content[0].text), result.result.structuredContent);
}
const calls = await Promise.all(
  Array.from({ length: 50 }, (_, id) =>
    rpc({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'marlo_coverage', arguments: {} },
    }),
  ),
);
const results = await Promise.all(calls.map((response) => response.json()));
assert.deepEqual(
  results.map((result) => result.id),
  Array.from({ length: 50 }, (_, id) => id),
);
console.log(
  `Verified ${checked} HTTP responses, ${paths.length} pages, ${rules.rules.length} rule endpoints, and every public MCP tool.`,
);
