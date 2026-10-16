import type { LlmTool } from './llm-provider.port.js';

/* The entity MCP (mcp/: the 3d-assets skill as tools), one connection per job. The job's capability token rides along on every request, so every
   write the MCP makes comes back to /api/editor/mcp/* as THIS job. */

export interface McpToolResult {
  text: string;
  isError: boolean;
}

export interface McpSession {
  listTools(signal?: AbortSignal): Promise<LlmTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult>;
  /** the `entity-editor` prompt: the system prompt for this job */
  getPrompt(args: { entityId?: string; kind?: string }, signal?: AbortSignal): Promise<string>;
  close(): Promise<void>;
}

export type SpecVerdict = { verdict: 'ok' | 'not_a_spec'; kind?: string | null; expect?: unknown } | { verdict: 'rejected'; kind?: string | null; errors: string[] };

export abstract class McpClientPort {
  /** is the MCP configured (EDITOR_MCP_TOKEN)? without it there is no AI editor */
  abstract readonly configured: boolean;
  abstract connect(jobToken: string, signal?: AbortSignal): Promise<McpSession>;
  /** the skill's spec gate on the user's sentence (POST /spec) – before any AI tokens */
  abstract spec(phrase: string): Promise<SpecVerdict>;
}
