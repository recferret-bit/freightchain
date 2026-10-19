import request from 'supertest';
import type { Server } from 'node:http';
import { McpClientPort, type McpSession, type McpToolResult, type SpecVerdict } from '../../src/application/ports/editor/mcp-client.port.js';
import type { LlmTool } from '../../src/application/ports/editor/llm-provider.port.js';
import { EDITOR_TOOLS } from '../../src/domain/editor/editor-job.js';
import { parseSource, validateEntity, type EntityConfig } from '../../src/domain/shared/entity.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

/** the 3d-assets skill's own validator (the real MCP's /spec uses it the same way – mcp/src/server.js specVerdict) */
type Evaluate = (phrase: string) => { ok: boolean; skipped?: boolean; kind?: string; errors?: string[]; expect?: unknown };
const VALIDATOR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..', '.claude', 'skills', '3d-assets', 'validate.mjs');
let evaluate: Evaluate | null = null;

const SPEC_KINDS = new Set(['car', 'tree', 'building']);
const json = (v: unknown): McpToolResult => ({ text: JSON.stringify(v), isError: false });
const fail = (v: unknown): McpToolResult => ({ text: JSON.stringify(v), isError: true });

/**
 * The entity MCP for the HTTP scenarios, in-process: the same tool names and answers as mcp/src/server.js (get_entity / check_entity / save_draft /
 * list_entities), and every read and write goes back into the app through /api/editor/mcp/* with the job's token – the real callback path.
 * `configured` follows EDITOR_MCP_TOKEN like the real adapter. `calls` records what the model asked for.
 */
export class TestMcpClient extends McpClientPort {
  readonly calls: { tool: string; args: Record<string, unknown> }[] = [];
  specCalls = 0;

  constructor(private readonly server: () => Server, private readonly isConfigured: () => boolean) { super(); }

  get configured(): boolean { return this.isConfigured(); }

  async spec(phrase: string): Promise<SpecVerdict> {
    this.specCalls++;
    evaluate ??= ((await import(pathToFileURL(VALIDATOR).href)) as { evaluate: Evaluate }).evaluate;
    const r = evaluate(String(phrase).slice(0, 4000));
    if (r.ok) return { verdict: r.skipped ? 'not_a_spec' : 'ok', kind: r.kind ?? null, expect: r.expect ?? null };
    if (r.kind && SPEC_KINDS.has(r.kind) && !(r.errors ?? []).every((e) => /unknown kind|ambiguous/i.test(e))) return { verdict: 'rejected', kind: r.kind, errors: r.errors ?? [] };
    return { verdict: 'not_a_spec', kind: r.kind ?? null };
  }

  async connect(jobToken: string): Promise<McpSession> {
    const app = () => request(this.server());
    const get = async (path: string) => { const r = await app().get(`/api/editor/mcp/${path}`).set('x-fc-job', jobToken); if (r.status !== 200) throw Object.assign(new Error(r.body?.detail ?? `HTTP ${r.status}`), { status: r.status }); return r.body as unknown; };
    const tools: LlmTool[] = EDITOR_TOOLS.map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));
    return {
      listTools: async () => tools,
      getPrompt: async (args) => `You edit Freight Chain entities.${args.entityId ? ` Entity: ${args.entityId}.` : ''}`,
      close: async () => undefined,
      callTool: async (name, args) => {
        this.calls.push({ tool: name, args });
        try {
          if (name === 'list_entities') return json(await get('entities'));
          if (name === 'get_entity') { const e = (await get(`entities/${String(args['id'])}`)) as { row: { kind: string }; source: string }; return json({ id: args['id'], kind: e.row.kind, source: e.source }); }
          if (name === 'check_entity') {
            let config: EntityConfig;
            try { config = parseSource(String(args['source'])) as EntityConfig; } catch (e) { return json({ ok: false, errors: [(e as Error).message], warnings: [] }); }
            const heads = (await get('configs')) as Record<string, EntityConfig>; heads[config.id] = config;
            const v = validateEntity(config, { lookup: (id) => heads[id] ?? null });
            return json({ ok: v.ok, id: config.id, errors: v.errors, warnings: v.warnings });
          }
          if (name === 'get_format') return { text: 'format', isError: false };
          if (name === 'diff_entity') return json({ removed: [], added: [] });
          if (name === 'validate_spec') return json({ verdict: 'not_a_spec' });
          if (name === 'save_draft') {
            const r = await app().post(`/api/editor/mcp/entities/${String(args['id'])}/drafts`).set('x-fc-job', jobToken).send({ source: args['source'], message: args['message'] });
            return r.status === 200 ? json({ saved: true, revisionId: r.body.id, entityId: r.body.entityId, seq: r.body.seq }) : fail({ error: `not saved: ${r.body?.detail ?? r.status}`, errors: r.body?.errors ?? [], status: r.status });
          }
          return fail({ error: `unknown tool ${name}` });
        } catch (e) { return fail({ error: (e as Error).message }); }
      },
    };
  }
}
