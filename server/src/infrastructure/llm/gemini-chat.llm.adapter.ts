import type { LlmOpenOptions, LlmSession, LlmToolResult, LlmTurn } from '../../application/ports/editor/llm-provider.port.js';
import { openAiErrorText, parseArgs } from './openai-responses.llm.adapter.js';

/* Gemini through its OpenAI-compatible Chat Completions endpoint (the openai SDK with Google's base URL). The assistant message goes back exactly as
   it came – Gemini 3 puts each tool call's thought signature into it (extra_content), and needs it back. Tool results are role 'tool' messages. */

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
type ChatMessage = { role: string; content: string | null; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]; refusal?: string | null };
type ChatResponse = { choices: { message: ChatMessage; finish_reason: string | null }[]; usage?: { prompt_tokens: number; completion_tokens: number } | null };
export interface ChatClientLike {
  chat: { completions: { create(params: unknown, options: { signal: AbortSignal }): Promise<unknown> } };
}

export class GeminiChatSession implements LlmSession {
  private readonly messages: unknown[];

  constructor(private readonly client: ChatClientLike, private readonly o: LlmOpenOptions) {
    this.messages = [{ role: 'system', content: o.system }];
  }

  send(text: string): Promise<LlmTurn> {
    this.messages.push({ role: 'user', content: text });
    return this.turn();
  }

  sendToolResults(results: readonly LlmToolResult[]): Promise<LlmTurn> {
    for (const r of results) this.messages.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `ERROR: ${r.content}` : r.content });
    return this.turn();
  }

  params(): Record<string, unknown> {
    return {
      model: this.o.model, messages: this.messages, max_tokens: this.o.maxOutputTokens,
      tools: this.o.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
    };
  }

  private async turn(): Promise<LlmTurn> {
    try {
      const r = (await this.client.chat.completions.create(this.params(), { signal: this.o.signal })) as ChatResponse;
      const choice = r.choices[0], usage = { in: r.usage?.prompt_tokens ?? 0, out: r.usage?.completion_tokens ?? 0 };
      if (!choice) return { text: '', toolCalls: [], stop: 'error', usage, detail: 'the provider answered no choice' };
      this.messages.push(choice.message);   // unchanged (thought signatures)
      const text = choice.message.content ?? '';
      if (choice.message.refusal || choice.finish_reason === 'content_filter') return { text, toolCalls: [], stop: 'refusal', usage, detail: choice.message.refusal ?? 'the model declined' };
      if (choice.finish_reason === 'length') return { text, toolCalls: [], stop: 'max_tokens', usage };
      const toolCalls = (choice.message.tool_calls ?? []).filter((c) => c.type === 'function').map((c) => ({ id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }));
      return { text, toolCalls, stop: toolCalls.length ? 'tool' : 'end', usage };
    } catch (e) {
      const why = openAiErrorText(e);
      if (why === null) throw e;
      return { text: '', toolCalls: [], stop: 'error', usage: { in: 0, out: 0 }, detail: why };
    }
  }
}
