#!/usr/bin/env node
/**
 * Packs every package, proves the packed copies work when installed, and publishes them.
 *
 *   node scripts/release.mjs --check     pack, install in a clean directory, run real scans
 *   node scripts/release.mjs --dry-run   the check, then `npm publish --dry-run` for each
 *   node scripts/release.mjs             the check, then publish what is not on npm yet
 *
 * A workspace test passes against source and symlinks, which is not what somebody gets from
 * npm. The first packed CLI could not find its own calibration table, and nothing in the
 * workspace noticed. So the check installs the tarballs exactly as a user would, into an
 * empty directory with no workspace above it, and runs the commands a user would run: the
 * broken demo page must exit 1, the clean one 0, and the MCP server must answer a call.
 *
 * Publishing goes in dependency order and skips any name and version already on npm, so a
 * release that failed halfway is finished by running it again. `pnpm pack` writes the
 * tarball, because it is what turns `workspace:*` into real version ranges; `npm publish`
 * sends it, because npm is what speaks trusted publishing from GitHub Actions. In CI it
 * adds `--provenance`, which links each version to the commit and workflow that built it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const dryRun = args.has('--dry-run');

/** Workspace packages, each after every package it depends on. */
export function publishOrder(packages) {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const done = new Set();
  const order = [];
  const visit = (name, path = []) => {
    if (done.has(name)) return;
    if (path.includes(name)) throw new Error(`dependency cycle: ${[...path, name].join(' -> ')}`);
    const pkg = byName.get(name);
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (byName.has(dep)) visit(dep, [...path, name]);
    }
    done.add(name);
    order.push(pkg);
  };
  for (const pkg of [...packages].sort((a, b) => a.name.localeCompare(b.name))) visit(pkg.name);
  return order;
}

function workspacePackages() {
  return readdirSync(resolve(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = resolve(ROOT, 'packages', entry.name);
      return { dir, ...JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) };
    })
    .filter((pkg) => pkg.private !== true);
}

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { encoding: 'utf8', stdio: 'pipe', ...options });
}

function pack(packages, into) {
  return new Map(
    packages.map((pkg) => {
      const out = run('pnpm', ['pack', '--pack-destination', into], { cwd: pkg.dir });
      const tarball = out
        .trim()
        .split('\n')
        .filter((line) => line.endsWith('.tgz'))
        .pop();
      if (tarball === undefined) throw new Error(`pnpm pack printed no tarball for ${pkg.name}`);
      return [pkg.name, resolve(into, tarball.split('/').pop())];
    }),
  );
}

function expectExit(label, result, code) {
  if (result.status !== code) {
    throw new Error(
      `${label} exited ${String(result.status)}, expected ${String(code)}.\n${result.stdout}${result.stderr}`,
    );
  }
  console.log(`  ok  ${label} exited ${String(code)} (${elapsed()})`);
}

/** Installs the tarballs into an empty project and runs what a user would run. */
function smokeTest(tarballs, scratch) {
  const app = join(scratch, 'app');
  run('mkdir', ['-p', app]);
  writeFileSync(join(app, 'package.json'), '{ "name": "smoke", "private": true }\n');
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...tarballs.values()], {
    cwd: app,
  });
  for (const page of ['checkout.html', 'clean.html']) {
    copyFileSync(resolve(ROOT, 'apps/demo', page), join(app, page));
  }
  const bin = (name) => join(app, 'node_modules', '.bin', name);
  const scan = (page) => spawnSync(bin('marlo'), ['scan', page], { cwd: app, encoding: 'utf8' });
  expectExit('marlo scan checkout.html', scan('checkout.html'), 1);
  expectExit('marlo scan clean.html', scan('clean.html'), 0);

  const call = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' },
      },
    },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'marlo_scan_html',
        arguments: { html: '<html><body><img src="x"></body></html>' },
      },
    },
  ];
  const mcp = spawnSync(bin('marlo-mcp'), [], {
    cwd: app,
    encoding: 'utf8',
    input: call.map((message) => JSON.stringify(message)).join('\n') + '\n',
  });
  const replies = mcp.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const scanned = replies.find((reply) => reply.id === 2);
  if (scanned?.result?.content?.[0]?.text?.includes('Coverage:') !== true) {
    throw new Error(`marlo-mcp did not answer a scan.\n${mcp.stdout}${mcp.stderr}`);
  }
  console.log(`  ok  marlo-mcp answered marlo_scan_html (${elapsed()})`);
}

function published(pkg) {
  const result = spawnSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], {
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.trim() === pkg.version;
}

const started = Date.now();
const elapsed = () => `${String(Math.round((Date.now() - started) / 1000))}s`;

function main() {
  const order = publishOrder(workspacePackages());
  const scratch = mkdtempSync(join(tmpdir(), 'marlo-release-'));
  try {
    console.log(`Packing ${String(order.length)} packages.`);
    const tarballs = pack(order, scratch);
    console.log(`Installing the tarballs into an empty project (${elapsed()}).`);
    smokeTest(tarballs, scratch);
    if (checkOnly) return;

    const publishArgs = ['--access', 'public'];
    if (process.env.GITHUB_ACTIONS === 'true') publishArgs.push('--provenance');
    if (dryRun) publishArgs.push('--dry-run');
    for (const pkg of order) {
      if (!dryRun && published(pkg)) {
        console.log(`  skip ${pkg.name}@${pkg.version}, already on npm`);
        continue;
      }
      execFileSync('npm', ['publish', tarballs.get(pkg.name), ...publishArgs], {
        stdio: 'inherit',
      });
      console.log(`  ${dryRun ? 'would publish' : 'published'} ${pkg.name}@${pkg.version}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
