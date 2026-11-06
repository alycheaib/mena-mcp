import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sampleRows } from './db.js';

export function createServer(db) {
  const server = new McpServer({ name: 'business-db', version: '0.1.0' }, {
    instructions: 'Read-only access to a business database. Call list_tables and describe_table before writing SQL. Personal data (emails, phones, IDs) is masked and secret columns are hidden. Reply in the user\'s language (Arabic or English).'
  });
  const ann = { readOnlyHint: true, openWorldHint: false, idempotentHint: true };

  const tool = (name, title, description, inputSchema, fn) =>
    server.registerTool(name, { title, description, inputSchema, annotations: ann }, async (args) => {
      try {
        const out = await fn(args);
        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
      }
    });

  tool('database_info', 'Database info', 'Show which database is connected and the safety settings in force.', {},
    () => ({ ...db.info(), demo: process.env.BUSINESS_DB_DEMO === '1', ...(process.env.BUSINESS_DB_DEMO === '1' ? { note: 'Sample database. Set BUSINESS_DB_URL to connect your own SQLite file or postgres:// URL.' } : {}), max_rows: db.cfg.maxRows, timeout_ms: db.cfg.timeoutMs, pii_masking: db.cfg.maskPii, allow_tables: db.cfg.allowTables, deny_tables: db.cfg.denyTables }));

  tool('list_tables', 'List tables', 'List the tables and views you can query, with row counts.', {},
    async () => ({ tables: await db.tables() }));

  tool('describe_table', 'Describe table', 'Columns, types, keys, foreign-key relationships and indexes of a table. Shows which columns hold personal data (masked) or secrets (hidden).',
    { table: z.string().min(1) }, async ({ table }) => db.describe(table));

  tool('sample_rows', 'Sample rows', 'Return the first few rows of a table to understand its data.',
    { table: z.string().min(1), limit: z.number().int().min(1).max(50).default(5) }, ({ table, limit }) => sampleRows(db, table, limit));

  tool('run_query', 'Run read-only SQL',
    'Run one read-only SQL query (SELECT/WITH). Use ? (SQLite) or $1 (Postgres) placeholders with params. Writes, DDL, PRAGMA, ATTACH and multiple statements are rejected; results are capped and personal data is masked.',
    { sql: z.string().min(1), params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(50).default([]) },
    ({ sql, params }) => db.query(sql, params));

  tool('explain_query', 'Explain query plan', 'Show the query plan for a read-only query (useful for slow reports and index advice).',
    { sql: z.string().min(1) }, ({ sql }) => db.explain(sql));

  return server;
}
