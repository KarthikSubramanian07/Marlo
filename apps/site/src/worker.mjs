const PROTOCOLS = ['2025-03-26', '2025-06-18', '2025-11-25'];
const MAX_BODY = 65536;
const SECURITY = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
};

/** An explicit media range takes precedence over a wildcard, including exclusions. */
export function quality(accept, media) {
  if (!accept) return 1;
  const [type] = media.split('/');
  let specificity = -1;
  let result = 0;
  for (const part of accept.toLowerCase().split(',')) {
    const [range, ...parameters] = part
      .trim()
      .split(';')
      .map((p) => p.trim());
    const score = range === media ? 2 : range === `${type}/*` ? 1 : range === '*/*' ? 0 : -1;
    if (score < 0 || score < specificity) continue;
    const q = parameters.find((p) => p.startsWith('q='));
    const value = q === undefined ? 1 : Number(q.slice(2));
    const bounded = Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
    if (score > specificity) result = bounded;
    else result = Math.max(result, bounded);
    specificity = score;
  }
  return result;
}

function prefersMarkdown(accept) {
  const markdown = quality(accept, 'text/markdown');
  const html = quality(accept, 'text/html');
  const explicit = (media) =>
    (accept ?? '')
      .toLowerCase()
      .split(',')
      .some((part) => part.trim().split(';')[0] === media);
  return (
    markdown > html ||
    (markdown > 0 && markdown === html && explicit('text/markdown') && !explicit('text/html'))
  );
}

async function readJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) return { tooLarge: true };
  if (!request.body) return { invalid: true };
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) {
        await reader.cancel();
        return { tooLarge: true };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return { invalid: true };
  } finally {
    reader.releaseLock();
  }
}

export function createSiteWorker({ origin, pages, api }) {
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const json = (value, status = 200, headers = {}) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    });
  const problem = (request, status, code, detail, hint, headers = {}) =>
    json(
      {
        type: 'about:blank',
        title: {
          400: 'Bad Request',
          403: 'Forbidden',
          404: 'Not Found',
          405: 'Method Not Allowed',
          406: 'Not Acceptable',
          413: 'Content Too Large',
          415: 'Unsupported Media Type',
        }[status],
        status,
        detail,
        instance: new URL(request.url).pathname,
        code,
        hint,
        docs: `${origin}/docs/`,
      },
      status,
      { 'Content-Type': 'application/problem+json; charset=utf-8', ...headers },
    );
  const tools = [
    {
      name: 'marlo_coverage',
      description:
        'Read measured Marlo coverage and engine accuracy. Report the limits alongside findings; this does not scan a page.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'marlo_list_rules',
      description:
        'List ACT rule metadata, implementation status, measurements and routing. This is calibration evidence, not a page scan.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'marlo_explain_rule',
      description:
        'Read one ACT rule and its measured engine accuracy before interpreting a finding. This does not evaluate HTML.',
      inputSchema: {
        type: 'object',
        properties: {
          actRuleId: {
            type: 'string',
            pattern: '^[a-z0-9]{6}$',
            description: 'The ACT rule identifier.',
          },
        },
        required: ['actRuleId'],
        additionalProperties: false,
      },
    },
  ].map((tool) => ({
    ...tool,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }));
  const rpcError = (id, code, message, status = 200) =>
    json({ jsonrpc: '2.0', id, error: { code, message } }, status);

  async function mcp(request) {
    const source = request.headers.get('origin');
    if (source && source !== origin && source !== new URL(request.url).origin) {
      return problem(
        request,
        403,
        'ORIGIN_REJECTED',
        'The request origin is not allowed.',
        'Call the endpoint from a server or its own origin.',
      );
    }
    if (request.method !== 'POST')
      return problem(
        request,
        405,
        'METHOD_NOT_ALLOWED',
        'This stateless MCP endpoint accepts POST only.',
        'POST one JSON-RPC message to /mcp; standalone event streams and sessions are not supported.',
        { Allow: 'POST' },
      );
    const protocol = request.headers.get('mcp-protocol-version');
    if (protocol && !PROTOCOLS.includes(protocol))
      return problem(
        request,
        400,
        'UNSUPPORTED_PROTOCOL',
        'The MCP protocol version is not supported.',
        `Use ${PROTOCOLS.at(-1)}.`,
      );
    const accept = request.headers.get('accept');
    if (
      !accept ||
      quality(accept, 'application/json') === 0 ||
      quality(accept, 'text/event-stream') === 0
    )
      return problem(
        request,
        406,
        'NOT_ACCEPTABLE',
        'MCP clients must accept JSON and event streams.',
        'Send Accept: application/json, text/event-stream.',
      );
    if (
      request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    )
      return problem(
        request,
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'MCP messages must be JSON.',
        'Send Content-Type: application/json.',
      );
    const body = await readJson(request);
    if (body.tooLarge)
      return problem(
        request,
        413,
        'BODY_TOO_LARGE',
        'The MCP request body exceeds the byte limit.',
        `Keep the request under ${MAX_BODY} bytes.`,
      );
    if (body.invalid) return rpcError(null, -32700, 'The request body is not valid JSON.', 400);
    const message = body.value;
    if (
      !object(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string' ||
      (message.id !== undefined &&
        !(
          typeof message.id === 'string' ||
          (typeof message.id === 'number' && Number.isFinite(message.id))
        )) ||
      (message.params !== undefined && !object(message.params))
    )
      return rpcError(null, -32600, 'Send one JSON-RPC request or notification.', 400);
    if (message.id === undefined) return new Response(null, { status: 202 });
    const reply = (result) => json({ jsonrpc: '2.0', id: message.id, result });
    const toolError = (text) => reply({ isError: true, content: [{ type: 'text', text }] });
    const params = message.params ?? {};
    if (params._meta !== undefined && !object(params._meta))
      return rpcError(message.id, -32602, 'Request metadata must be an object.');
    if (message.method === 'initialize') {
      if (
        typeof params.protocolVersion !== 'string' ||
        !object(params.capabilities) ||
        !object(params.clientInfo) ||
        typeof params.clientInfo.name !== 'string' ||
        typeof params.clientInfo.version !== 'string'
      )
        return rpcError(
          message.id,
          -32602,
          'Initialize requires protocolVersion, capabilities and clientInfo.',
        );
      return reply({
        protocolVersion: PROTOCOLS.includes(params.protocolVersion)
          ? params.protocolVersion
          : PROTOCOLS.at(-1),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'marlo', version: api.openapi.info.version },
        instructions:
          'Read coverage before interpreting rule evidence. Hosted tools expose metadata only. Use the local CLI to scan HTML.',
      });
    }
    if (message.method === 'ping') return reply({});
    if (message.method === 'tools/list') {
      if (Object.keys(params).some((key) => key !== '_meta'))
        return rpcError(message.id, -32602, 'This tool list has no cursor or parameters.');
      return reply({ tools });
    }
    if (message.method === 'tools/call') {
      const args = params.arguments ?? {};
      if (
        typeof params.name !== 'string' ||
        !object(args) ||
        Object.keys(params).some((key) => !['name', 'arguments', '_meta'].includes(key))
      )
        return rpcError(message.id, -32602, 'Provide a tool name and an arguments object.');
      const definition = tools.find((tool) => tool.name === params.name);
      if (!definition)
        return rpcError(
          message.id,
          -32602,
          'Unknown tool. Use tools/list to discover available tools.',
        );
      let value;
      if (params.name === 'marlo_explain_rule') {
        if (
          Object.keys(args).length !== 1 ||
          typeof args.actRuleId !== 'string' ||
          !/^[a-z0-9]{6}$/.test(args.actRuleId)
        )
          return toolError('Provide only actRuleId as a six-character ACT identifier.');
        value = api.rules.rules.find((rule) => rule.id === args.actRuleId);
        if (!value)
          return reply({
            isError: true,
            content: [
              {
                type: 'text',
                text: 'ACT rule not found. Use marlo_list_rules for available identifiers.',
              },
            ],
          });
      } else {
        if (Object.keys(args).length)
          return toolError('This tool takes an empty arguments object.');
        value = params.name === 'marlo_coverage' ? api.coverage : api.rules;
      }
      return reply({
        content: [{ type: 'text', text: JSON.stringify(value) }],
        structuredContent: value,
        isError: false,
      });
    }
    return rpcError(
      message.id,
      -32601,
      'Unknown method. Use initialize, ping, tools/list or tools/call.',
    );
  }

  async function handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/mcp' || path === '/mcp/') return mcp(request);
    const isApi = path === '/api' || path.startsWith('/api/');
    const machine = isApi || path === '/openapi.json' || path === '/.well-known/mcp';
    if (request.method === 'OPTIONS' && machine)
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Accept, Content-Type',
        },
      });
    if (!['GET', 'HEAD'].includes(request.method))
      return problem(
        request,
        405,
        'METHOD_NOT_ALLOWED',
        'This resource is read-only.',
        'Use GET or HEAD to read this resource.',
        { Allow: 'GET, HEAD, OPTIONS' },
      );
    if (machine) {
      if (quality(request.headers.get('accept'), 'application/json') === 0)
        return problem(
          request,
          406,
          'NOT_ACCEPTABLE',
          'This resource is available as JSON.',
          'Send Accept: application/json.',
        );
      const resources = {
        '/api/v1/coverage': api.coverage,
        '/api/v1/rules': api.rules,
        '/api/v1/calibration': api.calibration,
        '/openapi.json': api.openapi,
        '/.well-known/mcp': api.mcpManifest,
      };
      if (Object.hasOwn(resources, path)) return json(resources[path]);
      if (path.startsWith('/api/v1/rules/')) {
        const id = path.slice('/api/v1/rules/'.length);
        if (!/^[a-z0-9]{6}$/.test(id))
          return problem(
            request,
            400,
            'INVALID_RULE_ID',
            'ACT rule identifiers contain six lowercase letters or digits.',
            'Read /api/v1/rules for valid identifiers.',
          );
        const rule = api.rules.rules.find((entry) => entry.id === id);
        if (rule) return json(rule);
        return problem(
          request,
          404,
          'RULE_NOT_FOUND',
          'This ACT rule is not in the published corpus.',
          'Read /api/v1/rules for available rules.',
        );
      }
      return problem(
        request,
        404,
        'RESOURCE_NOT_FOUND',
        'This API resource does not exist.',
        'Use /openapi.json to discover supported endpoints.',
      );
    }
    if (url.search) url.search = '';
    const key = path === '/index.html' ? '/' : path.replace(/\/index\.html$/, '/');
    const canonical =
      key !== '/' && !key.endsWith('/') && Object.hasOwn(pages, `${key}/`) ? `${key}/` : key;
    if (Object.hasOwn(pages, canonical)) {
      const accept = request.headers.get('accept');
      const md = quality(accept, 'text/markdown');
      const html = quality(accept, 'text/html');
      if (Math.max(md, html) === 0)
        return problem(
          request,
          406,
          'NOT_ACCEPTABLE',
          'This page is available as HTML or Markdown.',
          'Send Accept: text/html or Accept: text/markdown.',
        );
      if (prefersMarkdown(accept))
        return new Response(pages[canonical], {
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        });
      url.pathname = canonical;
      const headers = new Headers(request.headers);
      headers.set('Accept', 'text/html');
      return env.ASSETS.fetch(new Request(url, { method: 'GET', headers }));
    }
    if (path.startsWith('/_') || path === '/404.html') return missing(request, env);
    const asset = await env.ASSETS.fetch(
      new Request(url, { method: 'GET', headers: request.headers }),
    );
    if (asset.status === 404) return missing(request, env);
    if (path.endsWith('.md')) {
      const headers = new Headers(asset.headers);
      headers.set('Content-Type', 'text/markdown; charset=utf-8');
      return new Response(asset.body, { status: asset.status, headers });
    }
    return asset;
  }

  async function missing(request, env) {
    const accept = request.headers.get('accept');
    if (prefersMarkdown(accept))
      return new Response(
        '# Resource not found\n\nThis Marlo resource does not exist. Check the URL or start with the [developer documentation](/docs/), [sitemap](/sitemap.xml), or [resource guide](/llms.txt).\n',
        { status: 404, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
      );
    const url = new URL('/404.html', request.url);
    const html = await env.ASSETS.fetch(new Request(url));
    return new Response(html.body, {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return {
    async fetch(request, env) {
      const response = await handle(request, env);
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(SECURITY)) headers.set(name, value);
      headers.set(
        'Vary',
        [
          ...new Set([
            ...(headers.get('Vary') ?? '')
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
            'Accept',
          ]),
        ].join(', '),
      );
      headers.set(
        'Link',
        `</llms.txt>; rel="describedby", </openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json", </developers/>; rel="service-doc"`,
      );
      headers.set(
        'Cache-Control',
        new URL(request.url).pathname.startsWith('/mcp') || response.status >= 400
          ? 'no-store'
          : (headers.get('Cache-Control') ?? 'public, max-age=300, must-revalidate'),
      );
      if (
        new URL(request.url).pathname.startsWith('/api/') ||
        ['/openapi.json', '/.well-known/mcp'].includes(new URL(request.url).pathname)
      )
        headers.set('Access-Control-Allow-Origin', '*');
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status,
        headers,
      });
    },
  };
}
