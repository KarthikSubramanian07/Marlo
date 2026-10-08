const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

function page(slug, title, description, sections) {
  return {
    path: `${slug}/index.html`,
    slug,
    title,
    description,
    body: `<section class="hero">
      <div class="hero__grid" aria-hidden="true"></div>
      <div class="wrap hero__inner">
        <span class="eyebrow eyebrow--accent">Marlo accessibility checker</span>
        <h1>${escapeHtml(title)}</h1>
        <p class="lede">${escapeHtml(description)}</p>
      </div>
    </section>
    ${sections
      .map(
        ([heading, content]) => `<section>
      <div class="wrap longform">
        <div class="section-head"><h2>${escapeHtml(heading)}</h2></div>
        <div class="prose stack">${content}</div>
      </div>
    </section>`,
      )
      .join('\n')}`,
  };
}

/** Public documentation uses the same layout and stylesheet as the measured results. */
export function developerPages({ ORIGIN, REPO }) {
  const origin = escapeHtml(ORIGIN);
  const repo = escapeHtml(REPO);
  return [
    page(
      'developers',
      'Marlo developer portal',
      'Use published accessibility measurements through the public API, local CLI, and MCP tools.',
      [
        [
          'Choose the surface for your job',
          `<p>Use the public API to inspect rule coverage, calibration evidence, and routing decisions. Use the local CLI to scan HTML you own and receive findings with engine provenance. The hosted API serves published metadata; it does not accept pages, upload source files, or run remote scans.</p>
          <p><a href="/docs/">Read the API and CLI documentation</a>, download <a href="/openapi.json">the OpenAPI specification</a>, or read <a href="/llms.txt">the machine-readable usage guide</a>. Published measurements remain visible on <a href="/accuracy/">The numbers</a> and their method is described on <a href="/method/">Method</a>.</p>`,
        ],
        [
          'Try the live metadata sandbox',
          `<p>No account, API key, or authorization header is required for these read-only requests. The sandbox is the same public metadata surface used by integrations.</p>
          <pre class="scroller" tabindex="0" role="region" aria-label="Command examples"><code>curl -sS '${origin}/api/v1/coverage'
curl -sS '${origin}/api/v1/rules'</code></pre>
          <p>Read the response before relying on a measurement. Missing evidence, unsupported renderer capabilities, and unimplemented rules are limitations to report, rather than successful accessibility checks.</p>`,
        ],
        [
          'MCP and source access',
          `<p>The <a href="/mcp">MCP endpoint</a> supports stateless Streamable HTTP for reading coverage, listing rules, and explaining a rule. Its tools are <code>marlo_coverage</code>, <code>marlo_list_rules</code>, and <code>marlo_explain_rule</code>. Discover the endpoint through <a href="/.well-known/mcp">the MCP manifest</a>.</p>
          <p>The <a href="${repo}">source repository</a> contains the CLI, rule implementations, calibration harness, and test corpus. CLI installation currently uses a source checkout. A registry release is not required for the public metadata API.</p>`,
        ],
      ],
    ),
    page(
      'docs',
      'Marlo API and CLI documentation',
      'Read measured accessibility coverage, inspect rule evidence, and scan local HTML with Marlo.',
      [
        [
          'Public API: authentication and endpoints',
          `<p>The public API is read-only and requires no authentication or API key. Its base URL is <code>${origin}/api/v1</code>. Successful responses use <code>application/json</code>. The <a href="/openapi.json">OpenAPI specification</a> defines operation identifiers, parameters, and response schemas.</p>
          <ul>
            <li><code>GET /api/v1/coverage</code>: published coverage and corpus totals.</li>
            <li><code>GET /api/v1/rules</code>: the published ACT rule catalog.</li>
            <li><code>GET /api/v1/rules/{actRuleId}</code>: a rule and its measured evidence. Replace the path parameter with an identifier returned by the catalog.</li>
            <li><code>GET /api/v1/calibration</code>: the published calibration table, including measurements and routing.</li>
          </ul>
          <pre class="scroller" tabindex="0" role="region" aria-label="Command examples"><code>curl -sS '${origin}/api/v1/coverage'
curl -sS '${origin}/api/v1/rules'
curl -sS '${origin}/api/v1/calibration'</code></pre>
          <p>These endpoints serve the same published data as the website. They do not perform a live audit. Corpus measurements describe behavior on that corpus and should not be presented as a prediction for every production page.</p>`,
        ],
        [
          'Errors and Markdown responses',
          `<p>API errors use RFC 9457 Problem Details with <code>Content-Type: application/problem+json</code>. The standard fields describe the problem and HTTP status; the <code>code</code> and <code>hint</code> extensions provide a stable error code and a resolution hint. Inspect the HTTP status before parsing a successful response.</p>
          <pre class="scroller" tabindex="0" role="region" aria-label="Command examples"><code>curl -sS -i '${origin}/api/v1/does-not-exist'
curl -sS -i -H 'Accept: text/markdown' '${origin}/'
curl -sS -i -H 'Accept: text/markdown' '${origin}/does-not-exist'</code></pre>
          <p>Pages support Markdown negotiation using <code>Accept: text/markdown</code>; the response has <code>Content-Type: text/markdown</code> and <code>Vary: Accept</code>. Requests for HTML continue to receive HTML. Unknown page paths return HTTP 404, including a Markdown explanation when requested. API paths keep their structured JSON errors.</p>`,
        ],
        [
          'Local CLI quickstart',
          `<p>Install from a <a href="${repo}">source checkout</a>, using the Node and pnpm versions declared in the repository. Run the commands below from the repository root, replacing <code>file.html</code> with an HTML file you own.</p>
          <pre class="scroller" tabindex="0" role="region" aria-label="Command examples"><code>pnpm install
pnpm build
node packages/cli/dist/bin.js scan file.html --json
node packages/cli/dist/bin.js coverage
node packages/cli/dist/bin.js explain ACT_RULE_ID</code></pre>
          <p>The scan writes its machine-readable report to standard output. Exit code <code>0</code> means no findings among evaluated rules, <code>1</code> means findings, <code>2</code> means a usage or input error, and <code>3</code> means incomplete evaluation when an error occurs or skipped rules are treated as failures. Add <code>--fail-on-skipped</code> when incomplete coverage must fail your check.</p>
          <p>The default static renderer does not evaluate layout-dependent rules. The optional browser renderer provides additional capabilities; consult the repository setup instructions before using <code>--renderer browser</code>. The default renderer executes inline scripts in the input, so scan trusted files you own. No hosted scan endpoint is provided.</p>`,
        ],
        [
          'MCP quickstart',
          `<p>Connect a client supporting Streamable HTTP to <code>${origin}/mcp</code>. Initialize the connection using the MCP protocol before listing or calling tools. Requests are stateless and do not require an API key. The manifest is available at <a href="/.well-known/mcp">/.well-known/mcp</a>.</p>
          <ul>
            <li><code>marlo_coverage</code> reads published coverage.</li>
            <li><code>marlo_list_rules</code> lists the published rule catalog.</li>
            <li><code>marlo_explain_rule</code> reads evidence for an ACT rule identifier.</li>
          </ul>
          <p>Use metadata to choose a suitable rule or engine. Run the CLI locally to evaluate a page, and retain skipped rules, peer disagreements, and measurement provenance in the report.</p>`,
        ],
      ],
    ),
    page(
      'about',
      'About Marlo accessibility checker',
      'Accessibility findings with published measurement evidence and visible limits.',
      [
        [
          'What Marlo does',
          `<p>Marlo is an open-source accessibility checker that reports findings alongside the evidence used to assess its own detection accuracy. The project compares its engine with peer engines using published ACT test cases, then records the measurements in a calibration table. The website reads that table rather than maintaining a separate set of marketing figures.</p>
          <p>Coverage has a denominator. A rule that needs layout cannot be treated as evaluated by a renderer that lacks layout. A skipped rule remains visible in the report. When peer engines disagree, the report retains the disagreement instead of allowing the selected engine to hide a failure.</p>
          <p>The <a href="/accuracy/">published numbers</a>, <a href="/method/">measurement method</a>, and <a href="/honesty/">record of defects</a> explain what has been tested and what those results mean. Automated checks cover specific defects and do not replace a broader accessibility review with people using the product.</p>`,
        ],
        [
          'Inspect and contribute',
          `<p>The <a href="${repo}">MIT-licensed source repository</a> contains the implementations, test fixtures, and calibration harness. Use the <a href="/developers/">developer portal</a> for programmatic access, and the <a href="/contact/">contact page</a> to report an incorrect finding or a problem with the published documentation. Measurements are useful only when readers can inspect the evidence and challenge the result.</p>`,
        ],
      ],
    ),
    page(
      'contact',
      'Contact Marlo',
      'Report an incorrect accessibility finding, a documentation problem, or an integration defect.',
      [
        [
          'Use the public issue tracker',
          `<p>The <a href="${repo}/issues">Marlo issue tracker</a> is the public contact channel for bug reports, feature requests, and questions about measurements. Search existing issues before opening a report so that related evidence stays together. This project does not publish a separate support email, telephone number, or postal support address.</p>
          <p>For an incorrect finding, include the ACT rule identifier, the CLI command, the renderer used, and a small HTML example that reproduces the behavior. Describe the observed result and the result you expected. Include relevant output with private values removed. A reproducible example makes it possible to check whether the defect belongs to a rule, an adapter, or the measurement harness.</p>
          <p>Issues and attachments are public. Do not include access tokens, credentials, customer information, private source code, or personal records. For a security concern, first consult the <a href="${repo}/blob/main/SECURITY.md">repository security policy</a> and follow its reporting instructions instead of posting exploit details in an ordinary issue.</p>`,
        ],
        [
          'Find an answer in the published evidence',
          `<p>Integration questions often start with the <a href="/docs/">API and CLI documentation</a>. Coverage questions can be checked against <a href="/rules/">the rule catalog</a> and <a href="/accuracy/">published measurements</a>. Reports should identify the data or page being questioned so the answer can be checked against the same evidence. No response time or private support service is promised.</p>`,
        ],
      ],
    ),
    page(
      'privacy',
      'Marlo privacy information',
      'What the public website and metadata endpoints receive, and how local scans differ.',
      [
        [
          'Website and public metadata',
          `<p>This website publishes documentation and accessibility calibration evidence. It has no account registration, payment form, source upload, or hosted page-scanning service. Its pages use locally served fonts and styles. The site does not include application analytics scripts, advertising scripts, or application cookies.</p>
          <p>Loading a page or calling a public endpoint sends an ordinary network request to the hosting service. That request includes connection information such as an IP address and headers supplied by your client. The hosting service may process request information for delivery, operations, and abuse prevention under its own policies. This page does not promise a retention period or the absence of infrastructure logs.</p>
          <p>The public API and MCP endpoint return existing rule metadata and published calibration results. They do not accept HTML uploads or scan URLs. Avoid placing credentials or private information in request URLs, query strings, or headers. Use the <a href="/docs/">documentation</a> to identify the supported endpoints.</p>`,
        ],
        [
          'Local files and public reports',
          `<p>The local CLI reads the HTML files you select and writes reports in your environment. Running a local scan is separate from visiting this website or requesting metadata. The default renderer executes inline scripts, so use trusted input and review the repository documentation before selecting optional integrations or renderers.</p>
          <p>The <a href="${repo}/issues">issue tracker</a> is public and operated separately from this website. Information you post there can be read by other visitors. Remove credentials, personal information, and private source before sharing a reproduction. For questions about this page, use the reporting guidance on <a href="/contact/">Contact Marlo</a>.</p>`,
        ],
      ],
    ),
  ];
}
