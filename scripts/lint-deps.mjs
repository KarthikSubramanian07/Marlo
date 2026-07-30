#!/usr/bin/env node
/**
 * Runs dependency-cruiser over the workspace directories that exist.
 *
 * `depcruise packages apps` fails with "Can't open 'apps' for reading" when the directory
 * is absent, and git does not track empty directories, so on a branch that has not created
 * an app yet the architecture check fails for a reason that has nothing to do with the
 * architecture.
 *
 * A check that fails for the wrong reason gets ignored, and then it is not a check. So the
 * targets are resolved here rather than hard-coded in a script line.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const targets = ['packages', 'apps'].filter((dir) => existsSync(resolve(ROOT, dir)));

if (targets.length === 0) {
  console.log('lint:deps: no workspace directories yet, nothing to cruise.');
  process.exit(0);
}

try {
  execFileSync('pnpm', ['exec', 'depcruise', '--config', '.dependency-cruiser.cjs', ...targets], {
    cwd: ROOT,
    stdio: 'inherit',
  });
} catch (error) {
  process.exit(
    typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 1,
  );
}
