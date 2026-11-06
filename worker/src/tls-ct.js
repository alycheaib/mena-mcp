// Certificate check for runtimes without raw TLS sockets:
// 1) a real HTTPS request proves the served certificate is trusted for the host;
// 2) Certificate Transparency logs (Cert Spotter, then crt.sh) give issuer, validity and SANs of the newest certificate.
const UA = 'infra-audit-mcp/0.1 (+https://github.com/alycheaib/mena-mcp)';
const TIMEOUT = 9000;

async function timedFetch(url, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try { return await fetch(url, { ...init, signal: ctl.signal, headers: { 'user-agent': UA, ...(init.headers || {}) } }); } finally { clearTimeout(t); }
}

const covers = (names, host) => names.some((n) => n === host || (n.startsWith('*.') && host.endsWith(n.slice(1)) && host.split('.').length === n.split('.').length));

async function fromCertSpotter(host) {
  const r = await timedFetch(`https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(host)}&expand=dns_names&expand=issuer`);
  if (!r.ok) throw new Error(`certspotter HTTP ${r.status}`);
  const list = (await r.json()).filter((c) => covers(c.dns_names || [], host));
  if (!list.length) return null;
  const c = list.sort((a, b) => b.not_before.localeCompare(a.not_before))[0];
  return { issuer: c.issuer?.friendly_name || c.issuer?.name || null, valid_from: c.not_before, valid_to: c.not_after, sans: c.dns_names, source: 'certspotter' };
}

async function fromCrtSh(host) {
  const r = await timedFetch(`https://crt.sh/?q=${encodeURIComponent(host)}&output=json&exclude=expired`);
  if (!r.ok) throw new Error(`crt.sh HTTP ${r.status}`);
  const list = (await r.json()).filter((c) => covers(String(c.name_value).split('\n'), host));
  if (!list.length) return null;
  const c = list.sort((a, b) => String(b.not_before).localeCompare(String(a.not_before)))[0];
  return { issuer: /O=([^,]+)/.exec(c.issuer_name)?.[1] || c.issuer_name, valid_from: `${c.not_before}Z`, valid_to: `${c.not_after}Z`, sans: String(c.name_value).split('\n'), source: 'crt.sh' };
}

export async function checkTlsViaCt(host, port = 443) {
  const findings = [];
  let trusted = null;
  let authorizationError = null;
  try {
    const res = await timedFetch(`https://${host}${port === 443 ? '' : `:${port}`}/`, { method: 'HEAD', redirect: 'manual' });
    // Cloudflare returns 526 when the origin certificate is invalid
    trusted = res.status !== 526 && res.status !== 525;
    if (!trusted) authorizationError = `HTTP ${res.status} (TLS failure)`;
  } catch (e) {
    trusted = false;
    authorizationError = e.message;
  }
  if (trusted === false) findings.push({ severity: 'high', issue: `HTTPS connection failed or certificate not trusted: ${authorizationError}` });

  let ct = null;
  for (const src of [fromCertSpotter, fromCrtSh]) {
    try { ct = await src(host); if (ct) break; } catch { /* try next source */ }
  }
  let daysLeft = null;
  if (ct) {
    daysLeft = Math.floor((new Date(ct.valid_to) - Date.now()) / 86400000);
    if (daysLeft < 0) findings.push({ severity: 'critical', issue: `Newest logged certificate expired ${-daysLeft} days ago` });
    else if (daysLeft < 14) findings.push({ severity: 'high', issue: `Certificate expires in ${daysLeft} days` });
    else if (daysLeft < 30) findings.push({ severity: 'medium', issue: `Certificate expires in ${daysLeft} days` });
  }
  return {
    host, port, trusted, authorization_error: authorizationError, hostname_match: trusted,
    issuer: ct?.issuer ?? null, valid_from: ct ? new Date(ct.valid_from).toISOString() : null, valid_to: ct ? new Date(ct.valid_to).toISOString() : null,
    days_left: daysLeft, sans: ct?.sans?.slice(0, 50) ?? [], san_count: ct?.sans?.length ?? 0,
    method: `HTTPS handshake + certificate transparency (${ct?.source || 'no CT data'})`,
    note: 'Hosted edition: expiry comes from the newest certificate in CT logs, which is normally the one being served. Run the local server for a direct handshake inspection.',
    findings
  };
}
