// Apify Actor: Website Security & Compliance Audit (batch mode) + MCP server (Standby mode).
import http from 'node:http';
import { Actor, log } from 'apify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { auditDomain } from '../../../packages/infra-audit/src/checks.js';
import { mapAuditToControls } from '../../../packages/compliance/src/compliance.js';
import { createServer as complianceServer } from '../../../packages/compliance/src/server.js';
import { createServer as auditServer } from '../../../packages/infra-audit/src/server.js';

await Actor.init();

const isStandby = process.env.APIFY_META_ORIGIN === 'STANDBY' || Actor.config.get('metaOrigin') === 'STANDBY';

async function charge(eventName, count = 1) {
  try { await Actor.charge({ eventName, count }); } catch (e) { log.debug(`charge ${eventName} skipped: ${e.message}`); }
}

if (isStandby) {
  // ---------- MCP server mode ----------
  const port = Number(process.env.ACTOR_STANDBY_PORT || process.env.ACTOR_WEB_SERVER_PORT || 4321);
  const SERVERS = { compliance: complianceServer, 'infra-audit': auditServer };
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, mcp: ['/mcp', '/mcp/compliance', '/mcp/infra-audit'] }));
    }
    const m = /^\/mcp(?:\/(compliance|infra-audit))?\/?$/.exec(url.pathname);
    if (!m) { res.writeHead(404).end('Not found'); return; }
    if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST (stateless MCP endpoint)' }, id: null })); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400).end('Invalid JSON'); return; }
    const calls = (Array.isArray(parsed) ? parsed : [parsed]).filter((x) => x?.method === 'tools/call').length;
    if (calls) await charge('tool-call', calls);
    const server = SERVERS[m[1] || 'compliance']();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsed);
  });
  srv.listen(port, () => log.info(`MCP server listening on ${port} (/mcp = compliance, /mcp/infra-audit)`));
} else {
  // ---------- Batch audit mode ----------
  const input = (await Actor.getInput()) || {};
  const domains = [...new Set((input.domains || []).map((d) => String(d).trim()).filter(Boolean))];
  if (!domains.length) throw new Error('Input "domains" must contain at least one domain, e.g. ["example.com"]');
  const software = Array.isArray(input.software) ? input.software : [];
  const maxConcurrency = Math.min(Math.max(Number(input.maxConcurrency) || 5, 1), 20);
  log.info(`Auditing ${domains.length} domain(s), concurrency ${maxConcurrency}`);

  let ok = 0;
  const queue = [...domains];
  async function worker() {
    while (queue.length) {
      const domain = queue.shift();
      try {
        const audit = await auditDomain(domain, { software });
        const compliance = mapAuditToControls(audit);
        await Actor.pushData({
          domain: audit.domain, checkedAt: audit.checked_at, score: audit.grade.score, grade: audit.grade.letter,
          critical: audit.summary.critical, high: audit.summary.high, medium: audit.summary.medium, low: audit.summary.low,
          tlsDaysLeft: audit.details.tls?.days_left ?? null, tlsIssuer: audit.details.tls?.issuer ?? null,
          spf: audit.details.email?.spf ?? null, dmarcPolicy: audit.details.email?.dmarc_policy ?? null,
          hsts: Boolean(audit.details.headers?.security_headers?.['strict-transport-security']),
          server: audit.details.headers?.server ?? null,
          topFindings: audit.findings.slice(0, 10).map((f) => `[${f.severity}] ${f.issue}`),
          findings: audit.findings,
          complianceMapping: input.includeComplianceMapping === false ? undefined : compliance,
          error: null
        });
        await charge('domain-audited');
        ok++;
      } catch (e) {
        log.warning(`${domain}: ${e.message}`);
        await Actor.pushData({ domain, error: e.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, domains.length) }, worker));
  log.info(`Done: ${ok}/${domains.length} audited`);
  await Actor.exit();
}
