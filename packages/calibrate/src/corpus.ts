import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ExpectedOutcome } from '@marlo/schema';

/**
 * Reads the vendored corpus from disk. The one place in the pipeline that does.
 *
 * @marlo/act holds the rule index as generated data because it is pure; the 1134 test
 * case documents are too large for that and are read here, where filesystem access is
 * expected.
 *
 * The manifest is parsed with Zod rather than read with property access. It is a trust
 * boundary like any other, and the first version reached in with `Reflect.get`, which
 * produces `any` and hands an unvalidated shape to the harness that computes every
 * published number.
 */

const ManifestCase = z.object({
  ruleId: z.string().min(1),
  testcaseId: z.string().min(1),
  title: z.string(),
  expected: ExpectedOutcome,
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const Manifest = z.object({
  retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totals: z.object({
    rules: z.number().int().positive(),
    rulesWithTestCases: z.number().int().positive(),
    testCases: z.number().int().positive(),
  }),
  testCases: z.array(ManifestCase).min(1),
});

export type CorpusCase = z.infer<typeof ManifestCase>;

export interface Corpus {
  readonly retrieved: string;
  readonly totals: {
    readonly rules: number;
    readonly rulesWithTestCases: number;
    readonly testCases: number;
  };
  readonly cases: readonly CorpusCase[];
  /** Reads one test case document. Not cached: the whole corpus is 250 KiB. */
  read(testCase: CorpusCase): string;
  /** Cases for one rule, in the manifest's order, which is stable. */
  forRule(actRuleId: string): readonly CorpusCase[];
}

export function loadCorpus(repositoryRoot: string): Corpus {
  const dir = resolve(repositoryRoot, 'corpus/act');
  const parsed = Manifest.safeParse(
    JSON.parse(readFileSync(resolve(dir, 'MANIFEST.json'), 'utf8')),
  );

  if (!parsed.success) {
    throw new Error(
      `corpus/act/MANIFEST.json is not a valid corpus manifest:\n` +
        parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n') +
        '\nRegenerate it with `pnpm corpus:fetch`.',
    );
  }

  const manifest = parsed.data;
  const byRule = new Map<string, CorpusCase[]>();
  for (const testCase of manifest.testCases) {
    const list = byRule.get(testCase.ruleId) ?? [];
    list.push(testCase);
    byRule.set(testCase.ruleId, list);
  }

  return {
    retrieved: manifest.retrieved,
    totals: manifest.totals,
    cases: manifest.testCases,
    read: (testCase) => readFileSync(resolve(dir, testCase.path), 'utf8'),
    forRule: (actRuleId) => byRule.get(actRuleId) ?? [],
  };
}
