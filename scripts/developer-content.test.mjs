import { describe, expect, it } from 'vitest';

import { developerPages } from '../apps/site/src/developer-content.mjs';

const ORIGIN = 'https://example.test';
const REPO = 'https://example.test/source';
const pages = developerPages({ ORIGIN, REPO });
const find = (slug) => pages.find((page) => page.slug === slug);
const plainText = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('public developer documentation', () => {
  it('provides distinct pages compatible with the shared site layout', () => {
    expect(pages.map((page) => page.path)).toEqual([
      'developers/index.html',
      'docs/index.html',
      'about/index.html',
      'contact/index.html',
      'privacy/index.html',
    ]);
    for (const page of pages) {
      expect(page.title).toContain('Marlo');
      expect(page.description.length).toBeGreaterThan(30);
      expect(page.body).toContain('class="hero"');
      expect(page.body).toContain('class="wrap longform"');
      expect(page.body.match(/<h1>/g)).toHaveLength(1);
    }
  });

  it('publishes substantive trust pages with working contact routes', () => {
    for (const slug of ['about', 'contact', 'privacy']) {
      expect(plainText(find(slug).body).length).toBeGreaterThan(500);
    }
    expect(find('contact').body).toContain(`${REPO}/issues`);
    expect(find('contact').body).toContain(`${REPO}/blob/main/SECURITY.md`);
    expect(find('contact').body).toContain('Issues and attachments are public');
    expect(find('about').body).toContain('MIT-licensed');
  });

  it('links the predictable discovery resources from the portal', () => {
    for (const resource of ['/docs/', '/openapi.json', '/llms.txt', '/.well-known/mcp']) {
      expect(find('developers').body).toContain(`href="${resource}"`);
    }
    expect(find('developers').body).toContain('No account, API key');
    expect(find('developers').body).toContain('source checkout');
  });

  it('documents metadata, errors, negotiation, and the executable CLI surface', () => {
    const docs = find('docs').body;
    for (const endpoint of ['coverage', 'rules', 'rules/{actRuleId}', 'calibration']) {
      expect(docs).toContain(`GET /api/v1/${endpoint}`);
    }
    expect(docs).toContain('RFC 9457');
    expect(docs).toContain('application/problem+json');
    expect(docs).toContain('<code>code</code> and <code>hint</code>');
    expect(docs).toContain('Vary: Accept');
    expect(docs).toContain('HTTP 404');
    expect(docs).toContain(`curl -sS '${ORIGIN}/api/v1/coverage'`);
    expect(docs).toContain('node packages/cli/dist/bin.js scan file.html --json');
    expect(docs).toContain('--fail-on-skipped');
    expect(docs).toContain('executes inline scripts');
    expect(docs).toContain('No hosted scan endpoint');
    for (const tool of ['marlo_coverage', 'marlo_list_rules', 'marlo_explain_rule']) {
      expect(docs).toContain(tool);
    }
    expect(docs).toContain('stateless');
    expect(docs).toContain('Streamable HTTP');
  });

  it('separates application privacy behavior from infrastructure promises', () => {
    const privacy = find('privacy').body;
    expect(privacy).toContain('no account registration');
    expect(privacy).toContain('does not include application analytics scripts');
    expect(privacy).toContain('hosting service may process request information');
    expect(privacy).toContain('does not promise a retention period');
    expect(privacy).toContain('do not accept HTML uploads');
    expect(privacy).toContain('Remove credentials');
  });

  it('escapes configurable origins and repository links', () => {
    const escaped = developerPages({ ORIGIN: '<origin>', REPO: '"repository"' });
    expect(escaped.find((page) => page.slug === 'docs').body).toContain('&lt;origin&gt;');
    expect(escaped.find((page) => page.slug === 'about').body).toContain('&quot;repository&quot;');
  });
});
