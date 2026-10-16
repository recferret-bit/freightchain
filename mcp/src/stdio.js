#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';
import { FileBackend } from './backend.js';

/* The same tools over stdio for Claude Code on a checkout: entities are the repo's seed files (client/shared/entity/seed/), so a save is a
   file change you review and commit like any other – no database, no publish. Register: `claude mcp add fc-entities -- node mcp/src/stdio.js`. */
await buildServer(new FileBackend(), { name: 'freightchain-entities-files' }).connect(new StdioServerTransport());
