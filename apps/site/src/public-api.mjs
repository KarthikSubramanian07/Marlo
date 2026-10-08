const string = { type: 'string' };
const count = { type: 'integer', minimum: 0 };
const positiveCount = { type: 'integer', minimum: 1 };
const boolean = { type: 'boolean' };
const rate = { type: ['number', 'null'], minimum: 0, maximum: 1 };
const date = { type: 'string', format: 'date' };
const engine = { type: 'string', enum: ['marlo', 'axe-core', 'alfa', 'htmlcs'] };
const ruleId = { type: 'string', pattern: '^[a-z0-9]{6}$' };
const consistency = { type: 'string', enum: ['consistent', 'partial', 'incorrect', 'unmapped'] };
const list = (items) => ({ type: 'array', items });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

function schemas() {
  const row = object({ passed: count, failed: count, cantTell: count, inapplicable: count });
  const engineMetadata = object({ id: engine, version: string, mappedRules: count });
  return {
    Corpus: object({
      retrieved: date,
      rules: positiveCount,
      rulesWithTestCases: positiveCount,
      testCases: positiveCount,
    }),
    CoverageCounts: object({
      implemented: count,
      publishedActRules: positiveCount,
      calibratable: count,
      implementedButUnmeasurable: list(ruleId),
    }),
    Aggregate: object({
      strictPrecision: rate,
      strictRecall: rate,
      falsePositiveRate: rate,
      sampleSize: count,
    }),
    StrictAccuracy: object({
      truePositives: count,
      falsePositives: count,
      falseNegatives: count,
      trueNegatives: count,
      cantTellOnFailed: count,
      cantTellOnPassed: count,
      precision: rate,
      recall: rate,
      f1: rate,
      falsePositiveRate: rate,
    }),
    Measurement: object({
      actRuleId: ruleId,
      engine,
      engineVersion: string,
      engineRuleIds: list(string),
      mappingKind: { type: 'string', enum: ['exact', 'partial', 'superset', 'none'] },
      testCaseCount: count,
      matrix: object({
        passed: row,
        failed: row,
        inapplicable: row,
        errored: count,
        unsupported: count,
      }),
      act: object({
        consistency,
        automation: { type: 'string', enum: ['automated', 'semi-automated', 'not-applicable'] },
        disallowed: count,
      }),
      strict: ref('StrictAccuracy'),
      flatteredByProtocol: boolean,
    }),
    Routing: object({
      actRuleId: ruleId,
      chosen: { ...engine, type: ['string', 'null'], enum: [...engine.enum, null] },
      reason: {
        type: 'string',
        enum: ['best-measured', 'sole-implementer', 'uncalibrated', 'no-implementer'],
      },
      candidates: list(object({ engine, strictRecall: rate, strictPrecision: rate, consistency })),
      autoFixPermitted: boolean,
    }),
    Rule: object({
      id: ruleId,
      name: string,
      ruleType: { type: 'string', enum: ['atomic', 'composite'] },
      requirements: list(string),
      inputAspects: list(string),
      testCases: object({ passed: count, failed: count, inapplicable: count }),
      implemented: boolean,
      measurements: list(ref('Measurement')),
      routing: { anyOf: [ref('Routing'), { type: 'null' }] },
    }),
    Rules: object({ generated: date, rules: list(ref('Rule')) }),
    Coverage: object({
      generated: date,
      corpus: ref('Corpus'),
      coverage: ref('CoverageCounts'),
      renderer: { type: 'string', enum: ['static', 'browser'] },
      engines: list(object({ ...engineMetadata.properties, strict: ref('Aggregate') })),
      limits: object({
        readOnly: { const: true, type: 'boolean' },
        hostedScanning: { const: false, type: 'boolean' },
        authentication: { const: 'none', type: 'string' },
      }),
    }),
    Calibration: object({
      schemaVersion: { const: 1, type: 'integer' },
      generated: date,
      commit: { type: ['string', 'null'] },
      corpus: ref('Corpus'),
      engines: list(engineMetadata),
      renderer: { type: 'string', enum: ['static', 'browser'] },
      entries: list(ref('Measurement')),
      routing: list(ref('Routing')),
      autoFixThreshold: object({
        minStrictPrecision: { type: 'number', minimum: 0, maximum: 1 },
        minSampleSize: positiveCount,
        rationale: { type: 'string', minLength: 1 },
      }),
      coverage: ref('CoverageCounts'),
      aggregate: ref('Aggregate'),
    }),
    Problem: object({
      type: { type: 'string', format: 'uri-reference' },
      title: string,
      status: { type: 'integer', minimum: 400, maximum: 599 },
      detail: string,
      instance: { type: 'string', format: 'uri-reference' },
      code: string,
      hint: string,
      docs: { type: 'string', format: 'uri' },
    }),
  };
}

function pooled(entries) {
  const totals = { truePositives: 0, falsePositives: 0, falseNegatives: 0, trueNegatives: 0 };
  for (const entry of entries) {
    for (const key of Object.keys(totals)) totals[key] += entry.strict[key];
  }
  const { truePositives: tp, falsePositives: fp, falseNegatives: fn, trueNegatives: tn } = totals;
  const ratio = (numerator, denominator) => (denominator === 0 ? null : numerator / denominator);
  return {
    strictPrecision: ratio(tp, tp + fp),
    strictRecall: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn),
    sampleSize: tp + fp + fn + tn,
  };
}

/** Public metadata comes from the same committed evidence used by the CLI. */
export function createPublicApi({ origin, table, manifest }) {
  const coverage = {
    generated: table.generated,
    corpus: table.corpus,
    coverage: table.coverage,
    renderer: table.renderer,
    engines: table.engines.map((item) => ({
      ...item,
      strict: pooled(table.entries.filter((entry) => entry.engine === item.id)),
    })),
    limits: { readOnly: true, hostedScanning: false, authentication: 'none' },
  };
  const rules = {
    generated: table.generated,
    rules: manifest.rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      ruleType: rule.ruleType,
      requirements: rule.requirements,
      inputAspects: rule.inputAspects,
      testCases: rule.testCases,
      implemented: table.entries.some(
        (entry) =>
          entry.actRuleId === rule.id && entry.engine === 'marlo' && entry.mappingKind !== 'none',
      ),
      measurements: table.entries.filter((entry) => entry.actRuleId === rule.id),
      routing: table.routing.find((decision) => decision.actRuleId === rule.id) ?? null,
    })),
  };
  const problem = {
    description: 'Structured problem details with a stable error code and a resolution hint.',
    content: { 'application/problem+json': { schema: ref('Problem') } },
  };
  const operation = (operationId, description, responseSchema, parameters = []) => ({
    operationId,
    description,
    summary: description,
    security: [],
    parameters,
    responses: {
      200: {
        description: 'Published accessibility measurement metadata.',
        content: { 'application/json': { schema: ref(responseSchema) } },
      },
      400: problem,
      404: problem,
      405: problem,
      406: problem,
    },
  });
  const openapi = {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'Marlo accessibility checker public API',
      version: '1.0.0',
      description:
        'Anonymous, read-only access to published ACT rule measurements, coverage and routing. The hosted API does not scan URLs or accept page uploads. Run the CLI locally to scan a page.',
    },
    servers: [{ url: origin }],
    externalDocs: { description: 'Marlo developer documentation', url: `${origin}/developers/` },
    security: [],
    paths: {
      '/api/v1/coverage': {
        get: operation(
          'getCoverage',
          'Read measured coverage and pooled accuracy for each engine.',
          'Coverage',
        ),
      },
      '/api/v1/rules': {
        get: operation(
          'listRules',
          'List every published ACT rule, including rules Marlo does not implement.',
          'Rules',
        ),
      },
      '/api/v1/rules/{actRuleId}': {
        get: operation(
          'getRule',
          'Read a rule definition, measured engine results and routing decision.',
          'Rule',
          [
            {
              name: 'actRuleId',
              in: 'path',
              required: true,
              description: 'Six-character ACT rule identifier.',
              schema: ruleId,
            },
          ],
        ),
      },
      '/api/v1/calibration': {
        get: operation(
          'getCalibration',
          'Read the complete committed calibration table without changing its measurements.',
          'Calibration',
        ),
      },
    },
    components: { schemas: schemas() },
  };
  const mcpManifest = {
    name: 'Marlo accessibility checker',
    description:
      'Read published ACT measurements, list rules and explain rule routing. Scans run locally with the CLI.',
    transport: 'streamable-http',
    endpoint: `${origin}/mcp`,
    protocolVersion: '2025-11-25',
    authentication: 'none',
    readOnly: true,
    documentation: `${origin}/developers/`,
    openapi: `${origin}/openapi.json`,
    tools: ['marlo_coverage', 'marlo_list_rules', 'marlo_explain_rule'],
  };
  return { coverage, rules, calibration: table, openapi, mcpManifest };
}
