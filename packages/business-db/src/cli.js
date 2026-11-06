#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, openDatabase } from './db.js';
import { createDemoDatabase } from './demo.js';
import { createServer } from './server.js';

process.removeAllListeners('warning'); // silence node:sqlite ExperimentalWarning on stderr

// --demo, or no database configured: serve a generated sample Gulf trading-company database.
if (process.argv.includes('--demo') || !(process.env.BUSINESS_DB_URL || process.env.DATABASE_URL)) {
  const file = createDemoDatabase(path.join(os.tmpdir(), `business-db-mcp-demo-${process.pid}.db`));
  process.env.BUSINESS_DB_URL = file;
  process.env.BUSINESS_DB_DEMO = '1';
  process.on('exit', () => { try { db.close(); fs.rmSync(file, { force: true }); } catch { /* ignore */ } });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
}
const db = await openDatabase(loadConfig());
await createServer(db).connect(new StdioServerTransport());
