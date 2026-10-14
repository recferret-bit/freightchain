import type { ProviderId, ProviderInfo } from '../../../domain/editor/llm-providers.js';

/* A provider-neutral conversation with a tool-using model. Each adapter keeps its OWN native history, append-only (an Anthropic turn's thinking
   blocks go back unchanged; OpenAI's input items; Chat Completions messages) – the caller only ever sends text or tool results. */

export interface LlmTool {
  name: string;
  description: string;
  /** JSON schema of the arguments */
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmToolResult {
  id: string;
  content: string;
  isError: boolean;
}

export type LlmStop = 'tool' | 'end' | 'max_tokens' | 'refusal' | 'error';

export interface LlmTurn {
  text: string;
  toolCalls: LlmToolCall[];
  stop: LlmStop;
  usage: { in: number; out: number };
  /** why it stopped with 'error' or 'refusal', for the chat */
  detail?: string;
}

export interface LlmSession {
  send(userText: string): Promise<LlmTurn>;
  /** the results of the last turn's calls, all at once */
  sendToolResults(results: readonly LlmToolResult[]): Promise<LlmTurn>;
}

export interface LlmOpenOptions {
  provider: ProviderId;
  model: string;
  system: string;
  tools: readonly LlmTool[];
  maxOutputTokens: number;
  signal: AbortSignal;
  /** the job (the fake provider's script reads it; real providers ignore it) */
  job?: { prompt: string; entityId: string | null };
}

export abstract class LlmProviderPort {
  /** the providers whose key is set (never the keys) */
  abstract enabled(): ProviderInfo[];
  /** the provider the server prefers (EDITOR_DEFAULT_PROVIDER) when it is enabled */
  abstract preferred(): ProviderId | null;
  abstract open(options: LlmOpenOptions): LlmSession;
}
