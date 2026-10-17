import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishOrder } from './release.mjs';

const ROOT = resolve(import.meta.dirname, '..');

describe('the order packages are published in', () => {
  it('puts every package after the packages it depends on', () => {
    const order = publishOrder([
      { name: 'c', dependencies: { b: '1', a: '1' } },
      { name: 'b', dependencies: { a: '1', zod: '4' } },
      { name: 'a' },
    ]).map((p) => p.name);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('refuses a cycle rather than publishing half of one', () => {
    expect(() =>
      publishOrder([
        { name: 'a', dependencies: { b: '1' } },
        { name: 'b', dependencies: { a: '1' } },
      ]),
    ).toThrow(/cycle/);
  });

  it('orders the real workspace with the schema first and the surfaces last', () => {
    const packages = readdirSync(resolve(ROOT, 'packages')).map((dir) =>
      JSON.parse(readFileSync(resolve(ROOT, 'packages', dir, 'package.json'), 'utf8')),
    );
    const order = publishOrder(packages).map((p) => p.name);
    expect(order[0]).toBe('@trymarlo/schema');
    expect(order.indexOf('@trymarlo/cli')).toBeGreaterThan(order.indexOf('@trymarlo/calibrate'));
    expect(order.indexOf('@trymarlo/mcp')).toBeGreaterThan(order.indexOf('@trymarlo/cli'));
  });

  it('keeps every package at one version, so one tag names a whole release', () => {
    const versions = new Set(
      readdirSync(resolve(ROOT, 'packages')).map(
        (dir) =>
          JSON.parse(readFileSync(resolve(ROOT, 'packages', dir, 'package.json'), 'utf8')).version,
      ),
    );
    expect(versions.size).toBe(1);
  });

  it('publishes every workspace package with the calibration tables in the CLI', () => {
    const cli = JSON.parse(readFileSync(resolve(ROOT, 'packages/cli/package.json'), 'utf8'));
    expect(cli.files).toContain('calibration');
    expect(cli.scripts.prepack).toContain('stage-calibration.mjs');
    expect(cli.scripts.postpack).toContain('--clean');
    for (const dir of readdirSync(resolve(ROOT, 'packages'))) {
      const pkg = JSON.parse(readFileSync(resolve(ROOT, 'packages', dir, 'package.json'), 'utf8'));
      expect(pkg.name.startsWith('@trymarlo/'), pkg.name).toBe(true);
      expect(pkg.repository?.url, pkg.name).toBe(
        'git+https://github.com/KarthikSubramanian07/Marlo.git',
      );
    }
  });
});
