// End-to-end tests for the hosted (Streamable HTTP) edition.
// Run against local `wrangler dev` or production:  MCP_REMOTE_URL=https://... node --test test/remote.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = (process.env.MCP_REMOTE_URL || '').replace(/\/$/, '');
const skip = !BASE && 'set MCP_REMOTE_URL to run remote tests';

async function connect(name) {
  const client = new Client({ name: 'mena-mcp-remote-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${name}`)));
  const call = async (tool, args = {}) => {
    const r = await client.callTool({ name: tool, arguments: args });
    if (r.isError) return { error: r.content[0].text };
    return r.structuredContent ?? JSON.parse(r.content[0].text);
  };
  return { client, call };
}

let gulf, audit, hr, comp;
before(async () => {
  if (skip) return;
  [gulf, audit, hr, comp] = await Promise.all(['gulf-business', 'infra-audit', 'gcc-hr', 'compliance'].map(connect));
});
after(async () => { for (const c of [gulf, audit, hr, comp]) await c?.client.close(); });

test('gcc-hr over HTTP', { skip }, async () => {
  assert.equal((await hr.client.listTools()).tools.length, 6);
  assert.equal((await hr.call('uae_gratuity', { basic_salary: 9000, start_date: '2022-01-01', end_date: '2024-12-31' })).gratuity, 18900);
  assert.equal((await hr.call('ksa_end_of_service', { monthly_wage: 12000, start_date: '2016-01-01', end_date: '2023-12-31', reason: 'resignation' })).end_of_service_award, 44000);
  assert.equal((await hr.call('gosi_contributions', { basic_salary: 10000, housing_allowance: 2500, registration_date: '2024-09-01', on_date: '2026-11-01' })).total_monthly, 2937.5);
});

test('compliance over HTTP (no local storage on the hosted edition)', { skip, timeout: 60000 }, async () => {
  const names = (await comp.client.listTools()).tools.map((t) => t.name);
  assert.equal(names.length, 10);
  assert.ok(!names.includes('save_assessment'));
  assert.ok((await comp.call('crosswalk', { framework: 'iso27001', control_id: '8.24' })).equivalents.soc2.some((c) => c.id === 'CC6.7'));
  const g = await comp.call('gap_assessment', { answers: { access_control: 'partial', incident_response: 'no' } });
  assert.equal(g.gaps[0].domain, 'incident_response');
  assert.match((await comp.call('policy_template', { policy: 'access_control' })).markdown, /Access Control Policy/);
  const scan = await comp.call('technical_evidence_scan', { domain: 'github.com' });
  assert.ok(scan.suggested_answers.find((x) => x.domain === 'encryption'));
});

test('landing page, health and discovery', { skip }, async () => {
  const home = await fetch(`${BASE}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /mcp\/gulf-business/);
  assert.deepEqual((await (await fetch(`${BASE}/health`)).json()).servers, ['gulf-business', 'infra-audit', 'gcc-hr', 'compliance']);
  assert.equal((await fetch(`${BASE}/nope`)).status, 404);
  const pre = await fetch(`${BASE}/mcp/gulf-business`, { method: 'OPTIONS' });
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.equal((await fetch(`${BASE}/mcp/gulf-business`)).status, 405);
});

test('gulf-business over HTTP', { skip }, async () => {
  const { tools } = await gulf.client.listTools();
  assert.equal(tools.length, 12);
  assert.equal((await gulf.call('vat_calculate', { amount: 1000, country: 'SA' })).gross, 1150);
  assert.equal((await gulf.call('amount_to_arabic_words', { amount: 11000, currency: 'SAR' })).words, 'فقط أحد عشر ألف ريال سعودي لا غير');
  const q = await gulf.call('zatca_qr_encode', { seller_name: 'Bobs Records', vat_number: '310122393500003', timestamp: '2022-04-25T15:30:00Z', invoice_total: 1000, vat_total: 150 });
  assert.equal(q.base64, 'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==');
  assert.equal((await gulf.call('zatca_qr_decode', { base64: q.base64 })).fields.seller_name, 'Bobs Records');
  assert.equal((await gulf.call('iban_validate', { iban: 'SA0380000000608010167519' })).valid, true);
  assert.equal((await gulf.call('hijri_from_gregorian', { date: '2026-02-18' })).hijri, '1447-09-01');
  assert.equal((await gulf.call('gregorian_from_hijri', { hijri: '1447-09-01' })).gregorian, '2026-02-18');
  assert.equal((await gulf.call('working_days_add', { start: '2026-11-05', days: 1, country: 'SA' })).result, '2026-11-08');
  assert.match((await gulf.call('vat_calculate', { amount: 1, country: 'ZZ' })).error, /Unknown country/);
});

test('infra-audit over HTTP: DNS, email, EOL, certificate, headers, full audit', { skip, timeout: 60000 }, async () => {
  const { tools } = await audit.client.listTools();
  assert.equal(tools.length, 7);
  const dns = await audit.call('dns_records', { domain: 'google.com' });
  assert.ok(dns.a.length > 0); assert.ok(dns.mx.length > 0); assert.ok(dns.ns.length > 0);
  const mail = await audit.call('email_security', { domain: 'google.com' });
  assert.match(mail.spf, /^v=spf1/); assert.equal(mail.dmarc_policy, 'reject');
  const eol = await audit.call('eol_check', { product: 'php', version: '7.4' });
  assert.equal(eol.matched_cycle.end_of_life, true);
  const tls = await audit.call('tls_certificate', { host: 'github.com' });
  assert.equal(tls.trusted, true); assert.ok(tls.days_left > 0, JSON.stringify(tls));
  const h = await audit.call('http_security_headers', { url: 'github.com' });
  assert.ok(h.security_headers['strict-transport-security']);
  const full = await audit.call('audit_domain', { domain: 'github.com' });
  assert.ok(full.grade.score > 0);
  assert.match((await audit.call('tls_certificate', { host: '127.0.0.1' })).error, /Refusing/);
  assert.match((await audit.call('http_security_headers', { url: 'http://169.254.169.254/' })).error, /Refusing/);
});
