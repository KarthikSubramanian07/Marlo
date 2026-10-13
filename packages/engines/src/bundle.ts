import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Finds and reads the browser bundles the build produces.
 *
 * Two engines need a bundle step before they can run inside a page: Alfa, because it
 * is a set of ES modules, and Marlo's own rules, for the same reason. esbuild writes
 * each into its package's `dist` as part of that package's `build` script. The source
 * file that injects a bundle therefore has to find `dist` from wherever it is running,
 * and it runs from two places: `dist` itself after a build, and `src` under Vitest,
 * which aliases every workspace package to its source.
 *
 * Resolving the package's own `package.json` and walking into `dist` from there works
 * from both, which is why the caller passes that path rather than `import.meta.url`.
 */

/** The absolute path of a bundle, given the path of the owning package's package.json. */
export function bundlePath(packageJsonPath: string, file: string): string {
  return resolve(dirname(packageJsonPath), 'dist', file);
}

/**
 * Reads a bundle, or says exactly what is missing and how to produce it.
 *
 * A clean checkout has no `dist`, and the unit suite deliberately never needs one. The
 * browser path does, and "ENOENT" several frames deep would send a reader looking for
 * a bug rather than for a build.
 */
export function readBundle(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The ${label} browser bundle is missing at ${path}. It is produced by \`pnpm build\`, ` +
        `so run that first. (${detail})`,
    );
  }
}
