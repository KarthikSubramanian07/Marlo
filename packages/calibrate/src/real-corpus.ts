import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ActRuleId, Outcome } from '@trymarlo/schema';

/**
 * Reads a real-page corpus from disk: the snapshotted pages and the adjudication record.
 * There are two, with the same layout: corpus/real, where the engine's errors were
 * analysed, and corpus/heldout, from different sites, rated before any change made after
 * that analysis was measured on it.
 *
 * Kept apart from corpus.ts, which reads the ACT corpus, so the two can never be loaded
 * through the same path by accident and pooled. A real page has no expected outcome in
 * its manifest at all; its ground truth is whatever two raters resolved, and it lives in
 * a different file with a different shape.
 */

const ManifestPage = z.object({
  id: z.string().regex(/^[a-z]+-\d{2}$/),
  category: z.string().regex(/^[a-z]+$/),
  url: z.url(),
  retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
});

const Manifest = z.object({
  retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totals: z.object({
    pages: z.number().int().positive(),
    categories: z.record(z.string(), z.number().int().positive()),
  }),
  pages: z.array(ManifestPage).min(1),
});

/** The real-page corpora, by directory name under corpus/. */
export type RealCorpusName = 'real' | 'heldout';

export type RealPage = z.infer<typeof ManifestPage> & {
  /** Category and digest prefix: how every published table names this page. */
  readonly label: string;
};

export interface RealCorpusSource {
  readonly retrieved: string;
  readonly pages: readonly RealPage[];
  readonly categories: Readonly<Record<string, number>>;
  /** Reads one page. Not cached: some pages are near two megabytes. */
  read(page: RealPage): string;
}

/** `government (85fa82766479)`. Never the URL; see corpus/real/NOTICE.md. */
export function pageLabel(page: { readonly category: string; readonly sha256: string }): string {
  return `${page.category} (${page.sha256.slice(0, 12)})`;
}

export function loadRealCorpus(
  repositoryRoot: string,
  name: RealCorpusName = 'real',
): RealCorpusSource {
  const dir = resolve(repositoryRoot, 'corpus', name);
  const parsed = Manifest.safeParse(
    JSON.parse(readFileSync(resolve(dir, 'MANIFEST.json'), 'utf8')),
  );
  if (!parsed.success) {
    throw new Error(
      `corpus/${name}/MANIFEST.json is not a valid manifest:\n` +
        parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  const manifest = parsed.data;
  if (manifest.totals.pages !== manifest.pages.length) {
    throw new Error(
      `corpus/${name}/MANIFEST.json claims ${String(manifest.totals.pages)} pages and lists ` +
        `${String(manifest.pages.length)}. Run \`node scripts/verify-real-corpus.mjs\`.`,
    );
  }
  return {
    retrieved: manifest.retrieved,
    pages: manifest.pages.map((p) => ({ ...p, label: pageLabel(p) })),
    categories: manifest.totals.categories,
    read: (page) => readFileSync(resolve(dir, page.path), 'utf8'),
  };
}

/**
 * One rater's worksheet, as `scripts/adjudicate.mjs sheet` writes it and a person fills
 * it in. Only the fields grading needs are read here.
 */
const SheetCell = z.object({
  page: z.string().min(1),
  rule: ActRuleId,
  answer: Outcome.nullable(),
  prescreened: z.boolean().default(false),
});

const Sheet = z.object({
  rater: z.enum(['A', 'B']),
  /** A person or a language model. Null on a sheet nobody has started. */
  raterKind: z.enum(['person', 'model']).nullable().default(null),
  raterModel: z.string().min(1).nullable().default(null),
  cells: z.array(SheetCell),
});

const ResolvedCell = z.object({
  page: z.string().min(1),
  rule: ActRuleId,
  answer: Outcome,
  source: z.enum(['agreement', 'prescreen', 'resolution']),
  resolverKind: z.enum(['person', 'model']).optional(),
});

const Resolved = z.object({ cells: z.array(ResolvedCell) });

export type SheetCell = z.infer<typeof SheetCell>;

export interface Adjudication {
  /** Rater A's cells, or none when no sheet exists. */
  readonly sheetA: readonly SheetCell[];
  readonly sheetB: readonly SheetCell[];
  /** Resolved ground truth, keyed `page/rule`. Empty until `adjudicate.mjs resolve` runs. */
  readonly resolved: ReadonlyMap<string, Outcome>;
  /** Each sheet's rater, for the sheets that exist. */
  readonly raters: readonly {
    readonly rater: 'A' | 'B';
    readonly kind: 'person' | 'model' | null;
    readonly model: string | null;
  }[];
  /** Resolved disagreements, by who resolved them. */
  readonly resolutions: { readonly person: number; readonly model: number };
}

export const cellKey = (page: string, rule: string): string => `${page}/${rule}`;

function readOptional<T>(file: string, schema: z.ZodType<T>, what: string): T | null {
  if (!existsSync(file)) return null;
  const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `${what} is not valid:\n` +
        parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n') +
        '\nRun `node scripts/adjudicate.mjs validate`.',
    );
  }
  return parsed.data;
}

export function loadAdjudication(
  repositoryRoot: string,
  name: RealCorpusName = 'real',
): Adjudication {
  const dir = resolve(repositoryRoot, 'corpus', name, 'adjudication');
  const a = readOptional(resolve(dir, 'sheet-A.json'), Sheet, 'sheet-A.json');
  const b = readOptional(resolve(dir, 'sheet-B.json'), Sheet, 'sheet-B.json');
  const resolved = readOptional(resolve(dir, 'resolved.json'), Resolved, 'resolved.json');
  const resolvedCells = resolved?.cells ?? [];
  const resolvedBy = (kind: 'person' | 'model'): number =>
    resolvedCells.filter((c) => c.source === 'resolution' && c.resolverKind === kind).length;
  return {
    sheetA: a?.cells ?? [],
    sheetB: b?.cells ?? [],
    resolved: new Map(resolvedCells.map((c) => [cellKey(c.page, c.rule), c.answer])),
    raters: [a, b]
      .filter((sheet) => sheet !== null)
      .map((sheet) => ({ rater: sheet.rater, kind: sheet.raterKind, model: sheet.raterModel })),
    resolutions: { person: resolvedBy('person'), model: resolvedBy('model') },
  };
}
