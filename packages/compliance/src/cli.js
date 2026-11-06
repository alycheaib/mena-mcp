#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import * as store from './store.js';

await createServer({}, store).connect(new StdioServerTransport());
