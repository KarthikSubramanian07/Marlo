#!/usr/bin/env node
/**
 * Copies the committed calibration tables into the CLI package while it is packed, and
 * removes them afterwards.
 *
 * Every confidence figure `marlo scan` prints comes from calibration/table.json, and an
 * installed package has no repository root above it to read that from. So the package
 * carries its own copy, taken from the committed file at the moment of packing, which
 * makes the published figures the committed ones. The copy is deleted after packing
 * (and ignored by git), so a checkout never reads a stale one instead of the root.
 *
 *   node scripts/stage-calibration.mjs           stage, from the CLI's prepack
 *   node scripts/stage-calibration.mjs --clean   remove, from the CLI's postpack
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TARGET = resolve(ROOT, 'packages/cli/calibration');
const TABLES = ['table.json', 'browser.json'];

if (process.argv.includes('--clean')) {
  rmSync(TARGET, { recursive: true, force: true });
} else {
  mkdirSync(TARGET, { recursive: true });
  for (const name of TABLES) {
    const from = resolve(ROOT, 'calibration', name);
    if (!existsSync(from)) {
      console.error(
        `stage-calibration: calibration/${name} is missing, so the package would ship without it.`,
      );
      process.exit(1);
    }
    copyFileSync(from, resolve(TARGET, name));
  }
}
