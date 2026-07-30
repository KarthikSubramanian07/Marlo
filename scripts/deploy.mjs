#!/usr/bin/env node
/**
 * Builds the site and deploys it to Cloudflare Pages.
 *
 * One command, per the build brief. It regenerates the site from the calibration table
 * first, so a deploy cannot publish numbers that disagree with the committed table, and it
 * refuses to deploy if the no-theatre tests are failing.
 *
 * Usage: node scripts/deploy.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const dryRun = process.argv.includes('--dry-run');

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
}

console.log('Rebuilding the site from calibration/table.json.');
run('node', ['apps/site/src/build.mjs']);

console.log('\nChecking the site does not lie about itself.');
run('pnpm', ['exec', 'vitest', 'run', '--project', 'unit', 'apps/site']);

if (dryRun) {
  console.log('\n--dry-run: built and checked, nothing deployed.');
  process.exit(0);
}

console.log('\nDeploying to Cloudflare Pages.');
run('pnpm', [
  'exec',
  'wrangler',
  'pages',
  'deploy',
  'apps/site/dist',
  '--project-name',
  'trymarlo',
  '--branch',
  'main',
  '--commit-dirty=true',
]);

console.log('\nhttps://trymarlo.pages.dev');
