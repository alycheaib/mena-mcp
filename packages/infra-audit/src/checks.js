// Passive, public-information checks only: no port scanning, no exploitation, no auth.
import tls from 'node:tls';
import dns from 'node:dns/promises';
import net from 'node:net';

const TIMEOUT_MS = Number(process.env.INFRA_AUDIT_TIMEOUT_MS || 10000);
const EOL_BASE = (process.env.ENDOFLIFE_BASE_URL || 'https://endoflife.date/api').replace(/\/$/, '');
const UA = 'infra-audit-mcp/0.1 (+https://github.com/alycheaib/mena-mcp)';

// ---------- target safety ----------
export function normalizeHost(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('A domain or URL is required');
  if (/^[a-z]+:\/\//i.test(s)) s = new URL(s).hostname;
  s = s.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(s) && !net.isIP(s)) throw new Error(`Invalid host: ${input}`);
  return s;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Refuse internal targets unless INFRA_AUDIT_ALLOW_PRIVATE=1 (prevents the tool being used to probe a private network). */
export async function assertPublicHost(host) {
  if (process.env.INFRA_AUDIT_ALLOW_PRIVATE === '1') return;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new Error(`Refusing internal host ${host}`);
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  const bad = ips.find(isPrivateIp);
  if (bad) throw new Error(`Refusing ${host}: it resolves to a private/internal address (${bad}). Set INFRA_AUDIT_ALLOW_PRIVATE=1 to allow.`);
}

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);

// Runtimes without raw TLS sockets (e.g. Cloudflare Workers) plug in their own certificate provider here.
export const providers = { tls: null };

// ---------- TLS ----------
export async function checkTls(hostInput, port = 443) {
  const host = normalizeHost(hostInput);
  await assertPublicHost(host);
  if (providers.tls) return providers.tls(host, port);
  const sock = await withTimeout(new Promise((resolve, reject) => {
    const s = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, ALPNProtocols: ['h2', 'http/1.1'] }, () => resolve(s));
    s.once('error', reject);
  }), TIMEOUT_MS, 'TLS handshake');
  try {
    const cert = sock.getPeerCertificate(false);
    if (!cert || !cert.valid_to) throw new Error('Server did not present a certificate');
    const validTo = new Date(cert.valid_to);
    const validFrom = new Date(cert.valid_from);
    const daysLeft = Math.floor((validTo - Date.now()) / 86400000);
    const sans = (cert.subjectaltname || '').split(',').map((x) => x.trim().replace(/^DNS:/, '')).filter(Boolean);
    const hostnameError = tls.checkServerIdentity(host, cert);
    const findings = [];
    if (!sock.authorized) findings.push({ severity: 'high', issue: `Certificate not trusted: ${sock.authorizationError}` });
    if (hostnameError) findings.push({ severity: 'high', issue: `Certificate does not match ${host}` });
    if (daysLeft < 0) findings.push({ severity: 'critical', issue: `Certificate expired ${-daysLeft} days ago` });
    else if (daysLeft < 14) findings.push({ severity: 'high', issue: `Certificate expires in ${daysLeft} days` });
    else if (daysLeft < 30) findings.push({ severity: 'medium', issue: `Certificate expires in ${daysLeft} days` });
    const proto = sock.getProtocol();
    if (proto && /TLSv1(\.[01])?$/.test(proto)) findings.push({ severity: 'high', issue: `Negotiated outdated protocol ${proto}` });
    return {
      host, port, trusted: sock.authorized, authorization_error: sock.authorizationError || null,
      hostname_match: !hostnameError, protocol: proto, cipher: sock.getCipher()?.name, alpn: sock.alpnProtocol || null,
      subject: cert.subject?.CN || null, issuer: cert.issuer?.O || cert.issuer?.CN || null,
      valid_from: validFrom.toISOString(), valid_to: validTo.toISOString(), days_left: daysLeft,
      sans: sans.slice(0, 50), san_count: sans.length, serial: cert.serialNumber, fingerprint256: cert.fingerprint256,
      findings
    };
  } finally {
    sock.destroy();
  }
}

// ---------- HTTP security headers ----------
const HEADER_CHECKS = [
  { h: 'strict-transport-security', sev: 'high', fix: 'Add Strict-Transport-Security: max-age=31536000; includeSubDomains', httpsOnly: true },
  { h: 'content-security-policy', sev: 'medium', fix: "Add a Content-Security-Policy (start with default-src 'self' in report-only mode)" },
  { h: 'x-content-type-options', sev: 'low', fix: 'Add X-Content-Type-Options: nosniff' },
  { h: 'x-frame-options', sev: 'medium', fix: "Add X-Frame-Options: DENY (or CSP frame-ancestors 'none')", alt: (hd) => /frame-ancestors/i.test(hd['content-security-policy'] || '') },
  { h: 'referrer-policy', sev: 'low', fix: 'Add Referrer-Policy: strict-origin-when-cross-origin' },
  { h: 'permissions-policy', sev: 'low', fix: 'Add a Permissions-Policy restricting camera, microphone, geolocation' }
];

async function fetchHead(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'GET', redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': UA } });
  } finally {
    clearTimeout(t);
  }
}

export async function checkHeaders(urlInput) {
  let url = String(urlInput).trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const chain = [];
  let res;
  for (let i = 0; i < 6; i++) {
    const u = new URL(url);
    await assertPublicHost(normalizeHost(u.hostname));
    res = await fetchHead(url);
    chain.push({ url, status: res.status });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).toString(); await res.body?.cancel(); continue; }
    break;
  }
  await res.body?.cancel();
  const headers = Object.fromEntries(res.headers);
  const finalHttps = url.startsWith('https:');
  const findings = [];
  const present = {};
  for (const c of HEADER_CHECKS) {
    const v = headers[c.h];
    present[c.h] = v ?? null;
    if (c.httpsOnly && !finalHttps) continue;
    if (!v && !(c.alt && c.alt(headers))) findings.push({ severity: c.sev, issue: `Missing ${c.h}`, fix: c.fix });
  }
  const hsts = headers['strict-transport-security'];
  if (hsts) {
    const age = Number(/max-age=(\d+)/i.exec(hsts)?.[1] || 0);
    if (age < 15552000) findings.push({ severity: 'low', issue: `HSTS max-age is short (${age}s)`, fix: 'Use max-age of at least 6 months (15552000)' });
  }
  if (!finalHttps) findings.push({ severity: 'high', issue: 'Site does not end on HTTPS', fix: 'Redirect all HTTP traffic to HTTPS' });
  for (const leak of ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version']) {
    const v = headers[leak];
    if (v && /\d/.test(v)) findings.push({ severity: 'low', issue: `${leak} header reveals version: ${v}`, fix: `Remove or genericise the ${leak} header` });
  }
  const cookies = res.headers.getSetCookie?.() || [];
  for (const ck of cookies) {
    const name = ck.split('=')[0];
    if (finalHttps && !/;\s*secure/i.test(ck)) findings.push({ severity: 'medium', issue: `Cookie ${name} lacks Secure`, fix: 'Set the Secure flag' });
    if (!/;\s*httponly/i.test(ck)) findings.push({ severity: 'low', issue: `Cookie ${name} lacks HttpOnly`, fix: 'Set HttpOnly unless JavaScript must read it' });
  }
  return { requested: String(urlInput), final_url: url, status: res.status, redirects: chain, security_headers: present, server: headers.server || null, powered_by: headers['x-powered-by'] || null, grade: grade(findings), findings };
}

// ---------- DNS & email security ----------
const safe = async (p) => { try { return await p; } catch { return null; } };

export async function dnsRecords(domainInput) {
  const domain = normalizeHost(domainInput);
  const [a, aaaa, mx, ns, txt, caa, soa] = await Promise.all([
    safe(dns.resolve4(domain)), safe(dns.resolve6(domain)), safe(dns.resolveMx(domain)), safe(dns.resolveNs(domain)),
    safe(dns.resolveTxt(domain)), safe(dns.resolveCaa(domain)), safe(dns.resolveSoa(domain))
  ]);
  return {
    domain, a: a || [], aaaa: aaaa || [], mx: (mx || []).sort((x, y) => x.priority - y.priority), ns: ns || [],
    txt: (txt || []).map((r) => r.join('')), caa: caa || [], soa: soa || null
  };
}

const DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'mail', 'dkim', 's1', 's2', 'smtp', 'mandrill', 'zoho'];

export async function emailSecurity(domainInput) {
  const domain = normalizeHost(domainInput);
  const findings = [];
  const [txt, dmarcTxt, mx, mtaSts] = await Promise.all([
    safe(dns.resolveTxt(domain)), safe(dns.resolveTxt(`_dmarc.${domain}`)), safe(dns.resolveMx(domain)), safe(dns.resolveTxt(`_mta-sts.${domain}`))
  ]);
  const spfs = (txt || []).map((r) => r.join('')).filter((t) => /^v=spf1\b/i.test(t));
  const spf = spfs[0] || null;
  if (!spf) findings.push({ severity: 'high', issue: 'No SPF record', fix: 'Publish a TXT record like "v=spf1 include:<your mail provider> -all"' });
  else {
    if (spfs.length > 1) findings.push({ severity: 'high', issue: 'Multiple SPF records (SPF fails permanently)', fix: 'Merge into a single v=spf1 record' });
    if (/\+all\b/.test(spf)) findings.push({ severity: 'critical', issue: 'SPF ends with +all: anyone can send as this domain', fix: 'Use -all or ~all' });
    else if (/\?all\b/.test(spf) || !/[-~]all\b/.test(spf)) findings.push({ severity: 'medium', issue: 'SPF is neutral/open (no -all or ~all)', fix: 'End the SPF record with -all (or ~all while testing)' });
    const lookups = (spf.match(/\b(include:|a\b|a:|mx\b|mx:|ptr|exists:|redirect=)/gi) || []).length;
    if (lookups > 10) findings.push({ severity: 'high', issue: `SPF has ${lookups} DNS-lookup mechanisms (limit is 10)`, fix: 'Flatten or remove includes' });
  }
  const dmarc = (dmarcTxt || []).map((r) => r.join('')).find((t) => /^v=DMARC1/i.test(t)) || null;
  let policy = null;
  if (!dmarc) findings.push({ severity: 'high', issue: 'No DMARC record', fix: `Publish _dmarc.${domain} TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}"` });
  else {
    policy = /\bp=(\w+)/i.exec(dmarc)?.[1]?.toLowerCase() || null;
    if (policy === 'none') findings.push({ severity: 'medium', issue: 'DMARC policy is p=none (monitoring only, spoofed mail still delivered)', fix: 'Move to p=quarantine then p=reject after reviewing reports' });
    if (!/\brua=/i.test(dmarc)) findings.push({ severity: 'low', issue: 'DMARC has no rua= reporting address', fix: 'Add rua=mailto:... to receive aggregate reports' });
    const pct = Number(/\bpct=(\d+)/i.exec(dmarc)?.[1] ?? 100);
    if (pct < 100) findings.push({ severity: 'low', issue: `DMARC applies to only ${pct}% of mail`, fix: 'Raise pct to 100' });
  }
  const dkim = (await Promise.all(DKIM_SELECTORS.map(async (s) => {
    const r = await safe(dns.resolveTxt(`${s}._domainkey.${domain}`));
    return r && r.map((x) => x.join('')).some((t) => /p=/.test(t)) ? s : null;
  }))).filter(Boolean);
  if (!dkim.length && mx?.length) findings.push({ severity: 'info', issue: `No DKIM key found on common selectors (${DKIM_SELECTORS.length} tried); it may use a custom selector`, fix: 'Confirm DKIM signing is enabled at your mail provider' });
  if (!mx?.length) findings.push({ severity: 'info', issue: 'No MX records: domain does not receive mail', fix: 'If the domain never sends mail, publish "v=spf1 -all" and DMARC p=reject' });
  return {
    domain, mx: (mx || []).sort((x, y) => x.priority - y.priority).map((m) => `${m.priority} ${m.exchange}`),
    spf, dmarc, dmarc_policy: policy, dkim_selectors_found: dkim,
    mta_sts: (mtaSts || []).map((r) => r.join('')).find((t) => /^v=STSv1/i.test(t)) || null,
    grade: grade(findings), findings
  };
}

// ---------- end-of-life software (endoflife.date) ----------
async function eolFetch(path) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${EOL_BASE}/${path}`, { signal: ctl.signal, headers: { 'user-agent': UA, accept: 'application/json' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`endoflife.date returned HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function eolProducts(query) {
  const all = await eolFetch('all.json');
  if (!Array.isArray(all)) throw new Error('Unexpected response from endoflife.date');
  const q = String(query || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const norm = (p) => p.replace(/[^a-z0-9]/g, '');
  const hits = q ? all.filter((p) => norm(p).includes(q) || (norm(p).length >= 3 && q.startsWith(norm(p)))) : all;
  return { query: query || null, total: hits.length, products: hits.slice(0, 100) };
}

const asDate = (v) => (typeof v === 'string' ? v : null);

export async function eolCheck(productInput, version) {
  const product = String(productInput).trim().toLowerCase().replace(/\s+/g, '-');
  const cycles = await eolFetch(`${encodeURIComponent(product)}.json`);
  if (!cycles) {
    const sugg = await safe(eolProducts(product.split('-')[0]));
    return { product, found: false, suggestions: sugg?.products?.slice(0, 10) || [] };
  }
  const today = new Date().toISOString().slice(0, 10);
  const status = (c) => {
    const eol = c.eol;
    const ended = eol === true || (typeof eol === 'string' && eol <= today);
    const support = c.support;
    const activeSupport = support === undefined ? null : support === false ? false : support === true ? true : support > today;
    return {
      cycle: String(c.cycle), latest: c.latest ?? null, release_date: asDate(c.releaseDate), eol: eol, end_of_life: ended,
      active_support: activeSupport, lts: c.lts ?? false, extended_support: c.extendedSupport ?? null
    };
  };
  const all = cycles.map(status);
  if (!version) return { product, found: true, cycles: all.slice(0, 15), supported_cycles: all.filter((c) => !c.end_of_life).map((c) => c.cycle) };
  const v = String(version).trim().replace(/^v/i, '');
  const match = cycles
    .filter((c) => v === String(c.cycle) || v.startsWith(`${c.cycle}.`) || v.startsWith(`${c.cycle}-`))
    .sort((a, b) => String(b.cycle).length - String(a.cycle).length)[0];
  if (!match) return { product, version: v, found: true, matched_cycle: null, note: 'No release cycle matches this version', known_cycles: all.slice(0, 15).map((c) => c.cycle) };
  const s = status(match);
  const findings = [];
  if (s.end_of_life) findings.push({ severity: 'high', issue: `${product} ${s.cycle} reached end of life${typeof s.eol === 'string' ? ` on ${s.eol}` : ''}: no security fixes`, fix: `Upgrade to a supported cycle (${all.filter((c) => !c.end_of_life).slice(0, 3).map((c) => c.cycle).join(', ')})` });
  else if (typeof s.eol === 'string') {
    const days = Math.floor((new Date(s.eol) - Date.now()) / 86400000);
    if (days < 180) findings.push({ severity: 'medium', issue: `${product} ${s.cycle} reaches end of life in ${days} days (${s.eol})`, fix: 'Plan the upgrade now' });
  }
  if (s.latest && v !== s.latest && /^\d/.test(v) && v.split('.').length >= s.latest.split('.').length) findings.push({ severity: 'low', issue: `Not on the latest patch (${s.latest})`, fix: `Update to ${s.latest}` });
  return { product, version: v, found: true, matched_cycle: s, findings };
}

// ---------- combined ----------
const SEV = { critical: 40, high: 20, medium: 8, low: 3, info: 0 };

export function grade(findings) {
  const score = Math.max(0, 100 - findings.reduce((s, f) => s + (SEV[f.severity] ?? 0), 0));
  const letter = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';
  return { score, letter };
}

export async function auditDomain(domainInput, { software = [] } = {}) {
  const domain = normalizeHost(domainInput);
  const settle = async (name, p) => { try { return [name, await p]; } catch (e) { return [name, { error: e.message }]; } };
  const parts = Object.fromEntries(await Promise.all([
    settle('tls', checkTls(domain)),
    settle('headers', checkHeaders(`https://${domain}`)),
    settle('email', emailSecurity(domain)),
    settle('dns', dnsRecords(domain)),
    ...software.map((s, i) => settle(`eol_${i}`, eolCheck(s.product, s.version)))
  ]));
  const findings = [];
  for (const [area, r] of Object.entries(parts)) {
    if (r?.error) findings.push({ area, severity: area === 'tls' || area === 'headers' ? 'high' : 'info', issue: `Check failed: ${r.error}` });
    for (const f of r?.findings || []) findings.push({ area: area.startsWith('eol_') ? 'software' : area, ...f });
  }
  const d = parts.dns;
  if (d && !d.error) {
    if (!d.caa?.length) findings.push({ area: 'dns', severity: 'low', issue: 'No CAA record: any CA may issue certificates for this domain', fix: 'Add CAA records for the CAs you use (e.g. 0 issue "letsencrypt.org")' });
    if ((d.ns || []).length === 1) findings.push({ area: 'dns', severity: 'medium', issue: 'Only one nameserver', fix: 'Use at least two nameservers on separate networks' });
  }
  const order = Object.keys(SEV);
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  const g = grade(findings);
  return {
    domain, checked_at: new Date().toISOString(), grade: g,
    summary: {
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length
    },
    findings, details: parts,
    disclaimer: 'Passive checks of public information only. Not a penetration test.'
  };
}
