import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { connect, online } from './helpers.js';
import { normalizeHost, grade } from '../packages/infra-audit/src/checks.js';

// Local fake web server + fake endoflife.date API, so the core tests run offline and deterministically.
const CYCLES = {
  php: [
    { cycle: '8.4', latest: '8.4.14', eol: '2028-12-31', support: '2026-12-31', releaseDate: '2024-11-21' },
    { cycle: '8.3', latest: '8.3.27', eol: '2027-12-31', support: '2025-12-31', releaseDate: '2023-11-23' },
    { cycle: '7.4', latest: '7.4.33', eol: '2022-11-28', support: '2021-11-28', releaseDate: '2019-11-28' }
  ]
};
let srv, base, s;
before(async () => {
  srv = http.createServer((req, res) => {
    if (req.url === '/api/all.json') return res.end(JSON.stringify(['php', 'python', 'phpmyadmin', 'nodejs']));
    const m = /^\/api\/([\w.-]+)\.json$/.exec(req.url);
    if (m) {
      if (!CYCLES[m[1]]) { res.statusCode = 404; return res.end('{}'); }
      return res.end(JSON.stringify(CYCLES[m[1]]));
    }
    if (req.url === '/weak') {
      res.setHeader('Server', 'Apache/2.4.29');
      res.setHeader('X-Powered-By', 'PHP/7.4.3');
      res.setHeader('Set-Cookie', 'sid=1; Path=/');
      return res.end('hi');
    }
    if (req.url === '/strong') {
      res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Permissions-Policy', 'camera=()');
      return res.end('ok');
    }
    if (req.url === '/redirect') { res.statusCode = 301; res.setHeader('Location', '/strong'); return res.end(); }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  s = await connect('infra-audit', { env: { INFRA_AUDIT_ALLOW_PRIVATE: '1', ENDOFLIFE_BASE_URL: `${base}/api` } });
});
after(async () => { await s.close(); srv.close(); });

test('exposes tools', async () => {
  const { tools } = await s.client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['audit_domain', 'dns_records', 'email_security', 'eol_check', 'eol_products', 'http_security_headers', 'tls_certificate']);
});

test('host normalisation and grading', () => {
  assert.equal(normalizeHost('https://Example.COM/path?x=1'), 'example.com');
  assert.equal(normalizeHost('example.com:8443'), 'example.com');
  assert.throws(() => normalizeHost('exa mple.com'), /Invalid host/);
  assert.deepEqual(grade([]), { score: 100, letter: 'A' });
  assert.equal(grade([{ severity: 'critical' }, { severity: 'high' }, { severity: 'high' }]).letter, 'F');
});

test('flags weak headers, version leaks and cookie flags', async () => {
  const r = await s.call('http_security_headers', { url: `${base}/weak` });
  const issues = r.findings.map((f) => f.issue).join(' | ');
  for (const x of ['Missing content-security-policy', 'Missing x-frame-options', 'server header reveals version', 'x-powered-by header reveals version', 'Cookie sid lacks HttpOnly', 'does not end on HTTPS']) {
    assert.ok(issues.includes(x), x);
  }
  assert.ok(r.grade.score < 60);
});

test('follows redirects and credits CSP frame-ancestors', async () => {
  const r = await s.call('http_security_headers', { url: `${base}/redirect` });
  assert.equal(r.redirects.length, 2);
  assert.ok(r.final_url.endsWith('/strong'));
  assert.ok(!r.findings.some((f) => f.issue === 'Missing x-frame-options'));
});

test('end-of-life checks', async () => {
  const old = await s.call('eol_check', { product: 'php', version: '7.4.3' });
  assert.equal(old.matched_cycle.cycle, '7.4');
  assert.equal(old.matched_cycle.end_of_life, true);
  assert.equal(old.findings[0].severity, 'high');
  const cur = await s.call('eol_check', { product: 'PHP', version: '8.4.14' });
  assert.equal(cur.matched_cycle.end_of_life, false);
  assert.equal(cur.findings.length, 0);
  const list = await s.call('eol_check', { product: 'php' });
  assert.deepEqual(list.supported_cycles, ['8.4', '8.3']);
  const nf = await s.call('eol_check', { product: 'phpx' });
  assert.equal(nf.found, false);
  assert.ok(nf.suggestions.includes('php'));
  assert.deepEqual((await s.call('eol_products', { query: 'php' })).products, ['php', 'phpmyadmin']);
});

test('refuses private targets by default (SSRF guard)', async () => {
  const guarded = await connect('infra-audit');
  try {
    for (const t of ['127.0.0.1', 'localhost', 'http://169.254.169.254/latest/meta-data', '10.0.0.5']) {
      const r = t.startsWith('http') ? await guarded.call('http_security_headers', { url: t }) : await guarded.call('tls_certificate', { host: t });
      assert.match(r.error, /Refusing/, t);
    }
  } finally {
    await guarded.close();
  }
});

test('live: TLS, email security and full audit of a real domain', async (t) => {
  if (!(await online('github.com'))) return t.skip('offline');
  const live = await connect('infra-audit');
  try {
    const tls = await live.call('tls_certificate', { host: 'github.com' });
    assert.equal(tls.trusted, true);
    assert.equal(tls.hostname_match, true);
    assert.ok(tls.days_left > 0);
    const mail = await live.call('email_security', { domain: 'google.com' });
    assert.match(mail.spf, /^v=spf1/);
    assert.equal(mail.dmarc_policy, 'reject');
    const audit = await live.call('audit_domain', { domain: 'github.com', software: [{ product: 'php', version: '7.4' }] });
    assert.ok(audit.grade.score >= 0 && audit.grade.score <= 100);
    assert.ok(audit.findings.some((f) => f.area === 'software' && f.severity === 'high'));
    assert.equal(audit.details.tls.trusted, true);
  } finally {
    await live.close();
  }
});
