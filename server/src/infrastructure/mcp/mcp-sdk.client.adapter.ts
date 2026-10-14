import { Injectable } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { LlmTool } from '../../application/ports/editor/llm-provider.port.js';
import { McpClientPort, type McpSession, type McpToolResult, type SpecVerdict } from '../../application/ports/editor/mcp-client.port.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import { EnvService } from '../config/env.service.js';

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
    const transport = new StreamableHTTPClientTransport(new URL(`${this.env.editorMcpUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}`, 'x-fc-job': jobToken } } });
    try { await client.connect(transport); } catch { throw new ServiceUnavailableError('the entity MCP is not reachable'); }
    return {
      listTools: async (): Promise<LlmTool[]> => (await client.listTools()).tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> })).sort((a, b) => (a.name < b.name ? -1 : 1)),
      callTool: async (name, args): Promise<McpToolResult> => toolText((await client.callTool({ name, arguments: args })) as ToolResult),
      getPrompt: async (args) => {
        const r = await client.getPrompt({ name: 'entity-editor', arguments: Object.fromEntries(Object.entries(args).filter(([, v]) => v)) as Record<string, string> });
        return r.messages.map((m) => (m.content.type === 'text' ? m.content.text : '')).join('\n');
      },
      close: () => client.close(),
    };
  }

  async spec(phrase: string): Promise<SpecVerdict> {
    const token = this.requireToken();
    let r: Response;
    try {
      r = await fetch(`${this.env.editorMcpUrl}/spec`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ phrase }), signal: AbortSignal.timeout(10_000) });
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
