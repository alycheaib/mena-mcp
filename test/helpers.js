import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Spawn a server's real CLI over stdio and connect an MCP client to it. */
export async function connect(pkg, { args = [], env = {} } = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--no-warnings', path.join(root, 'packages', pkg, 'src', 'cli.js'), ...args],
    env: { ...process.env, ...env },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'mena-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  const call = async (name, a = {}) => {
    const r = await client.callTool({ name, arguments: a });
    if (r.isError) return { error: r.content[0].text };
    return r.structuredContent ?? JSON.parse(r.content[0].text);
  };
  return { client, call, close: () => client.close() };
}

export async function online(host = 'endoflife.date') {
  const dns = await import('node:dns/promises');
  try { await dns.lookup(host); return true; } catch { return false; }
}
