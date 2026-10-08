import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPublicApi } from '../apps/site/src/public-api.mjs';

const table = JSON.parse(
  readFileSync(new URL('../calibration/table.json', import.meta.url), 'utf8'),
);
const manifest = JSON.parse(
  readFileSync(new URL('../corpus/act/MANIFEST.json', import.meta.url), 'utf8'),
);
const origin = 'https://trymarlo.pages.dev';
const api = createPublicApi({ origin, table, manifest });

// Exercise the documented schema vocabulary against the actual response data.
function validate(schema, value, components) {
  if (schema.$ref) return validate(components[schema.$ref.split('/').at(-1)], value, components);
  if (schema.anyOf) return schema.anyOf.some((item) => validate(item, value, components));
  if ('const' in schema && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (
    !types.includes(type) &&
    !(type === 'number' && types.includes('integer') && Number.isInteger(value))
  )
    return false;
  if (type === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }
  if (type === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    if (schema.format === 'uri' && !URL.canParse(value)) return false;
  }
  if (type === 'array') return value.every((item) => validate(schema.items, item, components));
  if (type === 'object') {
    if (!schema.required.every((key) => key in value)) return false;
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some((key) => !(key in schema.properties))
    )
      return false;
    return Object.entries(value).every(([key, item]) =>
      validate(schema.properties[key], item, components),
    );
  }
  return true;
}

describe('published API evidence', () => {
  it('preserves the complete calibration artifact and its coverage denominator', () => {
    expect(api.calibration).toEqual(table);
    expect(api.coverage.coverage).toEqual(table.coverage);
    expect(api.coverage.corpus).toEqual(table.corpus);
    expect(api.coverage.generated).toBe(table.generated);
    expect(api.coverage.limits).toEqual({
      readOnly: true,
      hostedScanning: false,
      authentication: 'none',
    });
  });

  it('includes unimplemented and unmeasurable rules with original metadata and all peer measurements', () => {
    expect(api.rules.rules).toHaveLength(manifest.rules.length);
    for (const rule of api.rules.rules) {
      const source = manifest.rules.find((item) => item.id === rule.id);
      const measurements = table.entries.filter((entry) => entry.actRuleId === rule.id);
      expect(rule).toMatchObject(source);
      expect(rule.measurements).toEqual(measurements);
      expect(rule.routing).toEqual(
        table.routing.find((item) => item.actRuleId === rule.id) ?? null,
      );
      expect(rule.implemented).toBe(
        measurements.some((entry) => entry.engine === 'marlo' && entry.mappingKind !== 'none'),
      );
    }
    expect(api.rules.rules.filter((rule) => rule.implemented)).toHaveLength(
      table.coverage.implemented,
    );
    expect(api.rules.rules.some((rule) => !rule.implemented)).toBe(true);
    expect(
      api.rules.rules.filter((rule) => Object.values(rule.testCases).every((n) => n === 0)),
    ).toHaveLength(manifest.totals.rules - manifest.totals.rulesWithTestCases);
  });

  it('pools counts separately per engine rather than averaging ratios or copying the mixed aggregate', () => {
    for (const result of api.coverage.engines) {
      const entries = table.entries.filter((entry) => entry.engine === result.id);
      const sum = (key) => entries.reduce((total, entry) => total + entry.strict[key], 0);
      const tp = sum('truePositives');
      const fp = sum('falsePositives');
      const fn = sum('falseNegatives');
      const tn = sum('trueNegatives');
      expect(result.strict).toEqual({
        strictPrecision: tp + fp === 0 ? null : tp / (tp + fp),
        strictRecall: tp + fn === 0 ? null : tp / (tp + fn),
        falsePositiveRate: fp + tn === 0 ? null : fp / (fp + tn),
        sampleSize: tp + fp + fn + tn,
      });
    }
    const changed = createPublicApi({
      origin,
      manifest,
      table: {
        ...table,
        aggregate: {
          strictPrecision: null,
          strictRecall: null,
          falsePositiveRate: null,
          sampleSize: 0,
        },
      },
    });
    expect(changed.coverage.engines).toEqual(api.coverage.engines);
  });

  it('returns absent measurements as null rather than inventing a zero error rate', () => {
    const empty = createPublicApi({ origin, manifest, table: { ...table, entries: [] } });
    for (const item of empty.coverage.engines) {
      expect(item.strict).toEqual({
        strictPrecision: null,
        strictRecall: null,
        falsePositiveRate: null,
        sampleSize: 0,
      });
    }
    expect(
      empty.rules.rules.every((rule) => !rule.implemented && rule.measurements.length === 0),
    ).toBe(true);
  });
});

describe('public API schema and discovery', () => {
  it('documents every supported route with unique operation identifiers, anonymous access and typed responses', () => {
    expect(api.openapi.openapi).toBe('3.1.0');
    expect(api.openapi.servers).toEqual([{ url: origin }]);
    expect(api.openapi.security).toEqual([]);
    expect(Object.keys(api.openapi.paths)).toEqual([
      '/api/v1/coverage',
      '/api/v1/rules',
      '/api/v1/rules/{actRuleId}',
      '/api/v1/calibration',
    ]);
    const operations = Object.values(api.openapi.paths).map((path) => path.get);
    expect(new Set(operations.map((operation) => operation.operationId)).size).toBe(
      operations.length,
    );
    for (const operation of operations) {
      expect(operation.description.length).toBeGreaterThan(20);
      expect(operation.security).toEqual([]);
      expect(operation.responses[200].content['application/json'].schema.$ref).toMatch(
        /^#\/components\/schemas\//,
      );
      for (const status of [400, 404, 405]) {
        expect(operation.responses[status].content['application/problem+json'].schema.$ref).toBe(
          '#/components/schemas/Problem',
        );
      }
    }
    expect(api.openapi.paths['/api/v1/rules/{actRuleId}'].get.parameters).toEqual([
      {
        name: 'actRuleId',
        in: 'path',
        required: true,
        description: 'Six-character ACT rule identifier.',
        schema: { type: 'string', pattern: '^[a-z0-9]{6}$' },
      },
    ]);
  });

  it('types every nested response field and validates real artifacts, including nullable measurements', () => {
    const components = api.openapi.components.schemas;
    expect(validate(components.Coverage, api.coverage, components)).toBe(true);
    expect(validate(components.Rules, api.rules, components)).toBe(true);
    expect(validate(components.Calibration, api.calibration, components)).toBe(true);
    for (const rule of api.rules.rules)
      expect(validate(components.Rule, rule, components)).toBe(true);
    expect(
      validate(components.Coverage, { ...api.coverage, generated: 'invalid' }, components),
    ).toBe(false);
    expect(
      validate(
        components.Coverage,
        { ...api.coverage, coverage: { ...api.coverage.coverage, implemented: -1 } },
        components,
      ),
    ).toBe(false);
    const inspect = (schema) => {
      if (schema.$ref) expect(components[schema.$ref.split('/').at(-1)]).toBeDefined();
      else if (schema.anyOf) schema.anyOf.forEach(inspect);
      else {
        expect(schema.type).toBeDefined();
        if (schema.type === 'object') {
          expect(schema.additionalProperties).toBe(false);
          expect(schema.required).toEqual(Object.keys(schema.properties));
          Object.values(schema.properties).forEach(inspect);
        }
        if (schema.type === 'array') inspect(schema.items);
      }
    };
    Object.values(components).forEach(inspect);
  });

  it('describes the hosted metadata tools and the real Streamable HTTP endpoint', () => {
    expect(api.mcpManifest.endpoint).toBe(`${origin}/mcp`);
    expect(api.mcpManifest.transport).toBe('streamable-http');
    expect(api.mcpManifest.protocolVersion).toBe('2025-11-25');
    expect(api.mcpManifest.readOnly).toBe(true);
    expect(api.mcpManifest.documentation).toBe(`${origin}/developers/`);
    expect(api.mcpManifest.openapi).toBe(`${origin}/openapi.json`);
    expect(api.mcpManifest.tools).toEqual([
      'marlo_coverage',
      'marlo_list_rules',
      'marlo_explain_rule',
    ]);
  });
});
