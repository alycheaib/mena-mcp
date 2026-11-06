import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkTls, checkHeaders, dnsRecords, emailSecurity, eolCheck, eolProducts, auditDomain } from './checks.js';

export function createServer() {
  const server = new McpServer({ name: 'infra-audit', version: '0.1.0' });
  const ann = { readOnlyHint: true, openWorldHint: true, idempotentHint: true };

  const tool = (name, title, description, inputSchema, fn) =>
    server.registerTool(name, { title, description, inputSchema, annotations: ann }, async (args) => {
      try {
        const out = await fn(args);
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    });

  const domain = z.string().min(1).describe('Domain or URL, e.g. example.com');

  tool('audit_domain', 'Full passive domain audit',
    'One-shot audit of a domain: TLS certificate, HTTPS security headers, SPF/DMARC/DKIM email security, DNS (CAA, nameservers) and optional end-of-life software. Returns a 0-100 score, letter grade and prioritised findings with fixes. Passive public checks only; only audit domains you own or are authorised to assess.',
    { domain, software: z.array(z.object({ product: z.string(), version: z.string() })).max(20).default([]).describe('Optional stack to check for end of life, e.g. [{"product":"php","version":"7.4"}]') },
    ({ domain: d, software }) => auditDomain(d, { software }));

  tool('tls_certificate', 'TLS certificate check',
    'Connect over TLS and report certificate trust, hostname match, issuer, expiry (days left), SANs, protocol and cipher.',
    { host: domain, port: z.number().int().min(1).max(65535).default(443) },
    ({ host, port }) => checkTls(host, port));

  tool('http_security_headers', 'HTTP security headers',
    'Fetch a URL (following redirects) and grade its security headers: HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, version leaks and cookie flags.',
    { url: z.string().min(1) }, ({ url }) => checkHeaders(url));

  tool('dns_records', 'DNS records', 'Look up A, AAAA, MX, NS, TXT, CAA and SOA records for a domain.',
    { domain }, ({ domain: d }) => dnsRecords(d));

  tool('email_security', 'Email security (SPF/DMARC/DKIM)',
    'Check whether a domain can be spoofed: SPF record and policy, DMARC policy and reporting, common DKIM selectors, MTA-STS.',
    { domain }, ({ domain: d }) => emailSecurity(d));

  tool('eol_check', 'End-of-life software check',
    'Check a product version against endoflife.date: is it still supported, when does support end, what is the latest patch. Product names use endoflife.date slugs, e.g. php, nodejs, python, ubuntu, windows-server, mysql, postgresql, django, laravel.',
    { product: z.string().min(1), version: z.string().optional().describe('Omit to list release cycles') },
    ({ product, version }) => eolCheck(product, version));

  tool('eol_products', 'Search endoflife.date products', 'Search the product slugs known to endoflife.date.',
    { query: z.string().optional() }, ({ query }) => eolProducts(query));

  return server;
}
