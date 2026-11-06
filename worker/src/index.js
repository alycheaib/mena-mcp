// Hosted (remote) edition of mena-mcp on Cloudflare Workers: stateless Streamable HTTP MCP endpoints.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker-provider.js';
import { createServer as gulfServer } from '../../packages/gulf-business/src/server.js';
import { createServer as auditServer } from '../../packages/infra-audit/src/server.js';
import { createServer as hrServer } from '../../packages/gcc-hr/src/server.js';
import { createServer as complianceServer } from '../../packages/compliance/src/server.js';
import { providers } from '../../packages/infra-audit/src/checks.js';
import { checkTlsViaCt } from './tls-ct.js';
import { landingPage } from './landing.js';

providers.tls = checkTlsViaCt;

const SERVERS = {
  'gulf-business': gulfServer,
  'infra-audit': auditServer,
  'gcc-hr': hrServer,
  compliance: complianceServer
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, authorization, mcp-session-id, mcp-protocol-version, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version'
};

const withCors = (res) => {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};

const json = (obj, status = 200) => withCors(new Response(JSON.stringify(obj, null, 2), { status, headers: { 'content-type': 'application/json' } }));

async function handleMcp(name, request) {
  if (request.method === 'GET' || request.method === 'DELETE') {
    // Stateless server: no standalone SSE stream and no sessions to delete.
    return json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this is a stateless MCP endpoint, use POST' }, id: null }, 405);
  }
  const server = SERVERS[name]({ jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request));
  } finally {
    // stateless: each request gets a fresh server; release it once the response is built
    queueMicrotask(() => server.close().catch(() => {}));
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    const m = /^\/(?:mcp\/)?(gulf-business|infra-audit|gcc-hr|compliance)(?:\/mcp)?\/?$/.exec(url.pathname);
    if (m) return handleMcp(m[1], request);
    if (url.pathname === '/health') return json({ ok: true, servers: Object.keys(SERVERS), version: '0.1.0' });
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(landingPage(url.origin), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
    }
    if (url.pathname === '/.well-known/mcp.json' || url.pathname === '/servers.json') {
      return json({ servers: Object.keys(SERVERS).map((n) => ({ name: n, transport: 'streamable-http', url: `${url.origin}/mcp/${n}` })), repository: 'https://github.com/alycheaib/mena-mcp' });
    }
    return json({ error: 'Not found', try: ['/', ...Object.keys(SERVERS).map((n) => `/mcp/${n}`), '/health'] }, 404);
  }
};
