import { Injectable } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { LlmTool } from '../../application/ports/editor/llm-provider.port.js';
import { McpClientPort, type McpSession, type McpToolResult, type SpecVerdict } from '../../application/ports/editor/mcp-client.port.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import { EnvService } from '../config/env.service.js';

const MCP_HOSTS = new Set(['mcp', '127.0.0.1', 'localhost']);
const MCP_BLOCKED = new Set(['169.254.169.254', 'metadata.google.internal', '0.0.0.0']);

/** the MCP origin the bridge may call. Production is the internal service only, so a job token cannot be sent to another host. */
export function mcpBaseUrl(raw: string, production: boolean): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ServiceUnavailableError('EDITOR_MCP_URL is not a URL'); }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || MCP_BLOCKED.has(u.hostname) || (production && !MCP_HOSTS.has(u.hostname))) {
    throw new ServiceUnavailableError('EDITOR_MCP_URL host is not allowed');
  }
  return new URL(u.origin);
}

/* The entity MCP (mcp/src/http.js, EDITOR_MCP_URL): Streamable HTTP, stateless. Every request carries `Authorization: Bearer EDITOR_MCP_TOKEN` and the
   job's capability token (`x-fc-job`), which the MCP hands back to /api/editor/mcp/* untouched. Tools are listed sorted by name (a stable prompt-cache prefix). */

type ToolResult = { content?: { type: string; text?: string }[]; isError?: boolean };

@Injectable()
export class McpSdkClientAdapter extends McpClientPort {
  constructor(private readonly env: EnvService) {
    super();
  }

  get configured(): boolean { return !!this.env.editorMcpToken; }

  async connect(jobToken: string): Promise<McpSession> {
    const token = this.requireToken();
    const client = new Client({ name: 'freightchain-editor-bridge', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${mcpBaseUrl(this.env.editorMcpUrl, this.env.isProduction).origin}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}`, 'x-fc-job': jobToken } } });
    try { await client.connect(transport); } catch { throw new ServiceUnavailableError('the entity MCP is not reachable'); }
    return {
      listTools: async (signal): Promise<LlmTool[]> => (await client.listTools(undefined, { signal })).tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> })).sort((a, b) => (a.name < b.name ? -1 : 1)),
      callTool: async (name, args, signal): Promise<McpToolResult> => toolText((await client.callTool({ name, arguments: args }, undefined, { signal })) as ToolResult),
      getPrompt: async (args, signal) => {
        const r = await client.getPrompt({ name: 'entity-editor', arguments: Object.fromEntries(Object.entries(args).filter(([, v]) => v)) as Record<string, string> }, { signal });
        return r.messages.map((m) => (m.content.type === 'text' ? m.content.text : '')).join('\n');
      },
      close: () => client.close(),
    };
  }

  async spec(phrase: string): Promise<SpecVerdict> {
    const token = this.requireToken();
    let r: Response;
    try {
      r = await fetch(`${mcpBaseUrl(this.env.editorMcpUrl, this.env.isProduction).origin}/spec`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ phrase }), signal: AbortSignal.timeout(10_000) });
    } catch { throw new ServiceUnavailableError('the entity MCP is not reachable'); }
    if (!r.ok) throw new ServiceUnavailableError(`the entity MCP answered ${r.status}`);
    return (await r.json()) as SpecVerdict;
  }

  private requireToken(): string {
    const t = this.env.editorMcpToken;
    if (!t) throw new ServiceUnavailableError('the AI editor is off (no EDITOR_MCP_TOKEN)');
    return t;
  }
}

/** an MCP tool result as text for the model (and the chat), with its error flag */
export function toolText(r: ToolResult): McpToolResult {
  return { text: (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n'), isError: r.isError === true };
}
