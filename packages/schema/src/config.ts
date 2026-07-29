import { z } from 'zod';
import { frozenList, frozenRecord } from './freeze.js';
import type { Capability } from './primitives.js';
import { EngineId } from './primitives.js';

/**
 * Configuration, parsed rather than read.
 *
 * `parseEnvironment` takes the environment as an argument instead of reaching for
 * `process.env`. Two reasons. @marlo/schema is a pure package, asserted by
 * dependency-cruiser, and a package that reads ambient state is not pure. And a
 * function taking its input as a parameter is testable without mutating a global
 * that every other test in the process shares.
 *
 * ESLint forbids `process.env` outside this path. The rule's message points here,
 * so a required key cannot be introduced without appearing in the schema below and
 * therefore in SETUP.md.
 */

/**
 * How natural language is produced, on the one code path where any is.
 *
 * `stub` is the default and is deterministic. With no API key and no network,
 * Marlo boots, the demo path works against fixtures, and the whole suite is green,
 * because the stub is what runs. There is no fallback that quietly upgrades to a
 * network call: `provider` has to be set explicitly.
 */
export const LanguageProvider = z.enum(['stub', 'anthropic']);
export type LanguageProvider = z.infer<typeof LanguageProvider>;

export const RendererChoice = z.enum(['static', 'browser']);
export type RendererChoice = z.infer<typeof RendererChoice>;

/**
 * The threshold policy for auto-fixing.
 *
 * Both values are policy, not measurements, and they are configurable because the
 * right answer depends on how much a wrong fix costs the caller. The defaults and
 * the reasoning for them are in docs/calibration.md; they are repeated in the
 * calibration table itself so a published number carries the policy it was
 * produced under.
 */
export const AutoFixPolicy = z.object({
  /**
   * Minimum measured strict precision for the reporting engine on the rule.
   * Precision rather than recall: a missed violation is a gap, and a wrong fix is
   * a change to somebody's code that they did not ask for.
   */
  minStrictPrecision: z.number().min(0).max(1).default(0.95),
  /**
   * Minimum official test cases behind the measurement. A precision of 1.0 over
   * two examples is not evidence.
   */
  minSampleSize: z.number().int().positive().default(6),
});
export type AutoFixPolicy = z.infer<typeof AutoFixPolicy>;

export const MarloConfig = z.object({
  renderer: RendererChoice.default('static'),
  engines: z.array(EngineId).min(1).default(['marlo', 'axe-core', 'alfa', 'htmlcs']),

  /**
   * Rules requiring a capability the renderer does not provide report
   * `unsupported`. Setting this true makes that an error exit rather than a note,
   * for a caller who would rather fail than proceed with an incomplete measurement.
   */
  failOnNotEvaluated: z.boolean().default(false),

  autoFix: AutoFixPolicy.prefault({}),

  /**
   * `.prefault({})` rather than `.default({})`. In Zod 4 `.default` takes the
   * parsed output, so defaulting an object means restating every field; `.prefault`
   * feeds `{}` through the parser, which is what makes the inner defaults apply.
   *
   * The object needs a default of its own at all because Marlo has to run with zero
   * configuration, and a nested object with defaults on every field but none of its
   * own quietly breaks `MarloConfig.parse({})` while each field looks correct in
   * isolation. A test asserts it.
   */
  language: z
    .object({
      provider: LanguageProvider.default('stub'),
      /** Never logged, never included in a report, never written to disk. */
      apiKey: z.string().min(1).nullable().default(null),
      model: z.string().min(1).default('claude-sonnet-5'),
      /** Cache directory for content-hashed generations. Null disables caching. */
      cacheDir: z.string().min(1).nullable().default(null),
    })
    .prefault({}),

  /** Structured log level. `silent` for library use inside another tool. */
  logLevel: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),

  /** Paths a repair may touch. An edit outside these is refused before it applies. */
  allowedPaths: z.array(z.string().min(1)).default([]),
});
export type MarloConfig = z.infer<typeof MarloConfig>;

/** Capabilities each renderer provides. Consumed by the capability model. */
export const RENDERER_CAPABILITIES: Readonly<Record<RendererChoice, readonly Capability[]>> =
  frozenRecord<RendererChoice, readonly Capability[]>({
    static: frozenList<Capability>('dom', 'script'),
    browser: frozenList<Capability>('dom', 'script', 'layout', 'paint'),
  });

const boolFromEnv = z
  .string()
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()))
  .pipe(z.boolean());

const EnvironmentShape = z.object({
  MARLO_RENDERER: RendererChoice.optional(),
  MARLO_ENGINES: z.string().optional(),
  MARLO_LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).optional(),
  MARLO_FAIL_ON_NOT_EVALUATED: boolFromEnv.optional(),
  MARLO_LANGUAGE_PROVIDER: LanguageProvider.optional(),
  MARLO_LANGUAGE_MODEL: z.string().min(1).optional(),
  MARLO_CACHE_DIR: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  MARLO_MIN_STRICT_PRECISION: z.coerce.number().min(0).max(1).optional(),
  MARLO_MIN_SAMPLE_SIZE: z.coerce.number().int().positive().optional(),
});

/**
 * The result of parsing configuration. A discriminated union rather than a throw,
 * because the CLI wants to print every problem at once and a thrown error reports
 * the first.
 */
export type ConfigResult =
  | { readonly ok: true; readonly config: MarloConfig; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Builds a validated config from an environment-shaped record and optional
 * overrides, which is how CLI flags arrive.
 *
 * Precedence is overrides, then environment, then defaults. Nothing is read from
 * anywhere else, so the whole configuration surface is these two arguments.
 */
export function parseEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  overrides: Readonly<Partial<MarloConfig>> = {},
): ConfigResult {
  const parsedEnv = EnvironmentShape.safeParse(env);
  if (!parsedEnv.success) {
    return {
      ok: false,
      problems: parsedEnv.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  const e = parsedEnv.data;
  const warnings: string[] = [];

  const enginesFromEnv =
    e.MARLO_ENGINES === undefined
      ? undefined
      : e.MARLO_ENGINES.split(',')
          .map((s) => s.trim())
          .filter(Boolean);

  const provider = overrides.language?.provider ?? e.MARLO_LANGUAGE_PROVIDER ?? 'stub';
  const apiKey = overrides.language?.apiKey ?? e.ANTHROPIC_API_KEY ?? null;

  // A key present with the stub provider is not an error, but silently ignoring
  // it is how someone concludes Marlo called a model when it did not.
  if (provider === 'stub' && apiKey !== null) {
    warnings.push(
      'An API key is set but the language provider is stub, so no model will be called. ' +
        'Set MARLO_LANGUAGE_PROVIDER to change that deliberately.',
    );
  }
  if (provider !== 'stub' && apiKey === null) {
    return {
      ok: false,
      problems: [
        `language.provider is "${provider}" but no API key is set. ` +
          'Set ANTHROPIC_API_KEY, or leave the provider as stub.',
      ],
    };
  }

  const candidate = {
    renderer: overrides.renderer ?? e.MARLO_RENDERER,
    engines: overrides.engines ?? enginesFromEnv,
    failOnNotEvaluated: overrides.failOnNotEvaluated ?? e.MARLO_FAIL_ON_NOT_EVALUATED,
    autoFix: {
      minStrictPrecision:
        overrides.autoFix?.minStrictPrecision ?? e.MARLO_MIN_STRICT_PRECISION ?? 0.95,
      minSampleSize: overrides.autoFix?.minSampleSize ?? e.MARLO_MIN_SAMPLE_SIZE ?? 6,
    },
    language: {
      provider,
      apiKey,
      model: overrides.language?.model ?? e.MARLO_LANGUAGE_MODEL ?? 'claude-sonnet-5',
      cacheDir: overrides.language?.cacheDir ?? e.MARLO_CACHE_DIR ?? null,
    },
    logLevel: overrides.logLevel ?? e.MARLO_LOG_LEVEL,
    allowedPaths: overrides.allowedPaths,
  };

  // Undefined keys are dropped so Zod applies its defaults rather than failing
  // exactOptionalPropertyTypes on an explicit undefined.
  const pruned = Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== undefined));

  const parsed = MarloConfig.safeParse(pruned);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }
  return { ok: true, config: parsed.data, warnings };
}

/**
 * Redacts anything that must never reach a log, a report, or a pull request body.
 *
 * Exists so that logging the config is safe by construction rather than by the
 * author of each log line remembering.
 */
export function redactConfig(config: MarloConfig): MarloConfig {
  return {
    ...config,
    language: {
      ...config.language,
      apiKey: config.language.apiKey === null ? null : '[redacted]',
    },
  };
}
