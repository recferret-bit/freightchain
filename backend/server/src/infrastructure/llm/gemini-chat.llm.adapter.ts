import type { LlmOpenOptions, LlmSession, LlmToolResult, LlmTurn } from '../../application/ports/editor/llm-provider.port.js';
import { openAiErrorText, parseArgs } from './openai-responses.llm.adapter.js';

/* Chat Completions through the openai SDK: Gemini (Google's OpenAI-compatible endpoint) and z.ai (GLM, ZAI_BASE_URL). The assistant message goes back exactly as
   it came – Gemini 3 puts each tool call's thought signature into it (extra_content), GLM its reasoning_content – both want it back. Tool results are role 'tool' messages.
   GLM thinks on every turn. One request is capped so a thought cannot spend the whole job, and a reply cut off for length is continued while the job budget remains. */

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
/** one request: enough for a max-size entity tool call, not the whole job */
const TURN_CAP = 32_768;
const MAX_CONTINUATIONS = 3;
const CONTINUE = 'Continue from the exact point the previous reply was cut off. Do not repeat text already written.';
type ToolCall = { id: string; type: string; function: { name: string; arguments: string } };
type ChatMessage = { role: string; content: string | null; tool_calls?: ToolCall[]; refusal?: string | null };
type ChatResponse = { choices: { message: ChatMessage; finish_reason: string | null }[]; usage?: { prompt_tokens: number; completion_tokens: number } | null };

/** Complete function calls, or null when an arguments string is not finished JSON. No calls is an empty list. */
function finishedToolCalls(message: ChatMessage): { id: string; name: string; input: Record<string, unknown> }[] | null {
  const calls = (message.tool_calls ?? []).filter((c) => c.type === 'function');
  if (!calls.length) return [];
  const out: { id: string; name: string; input: Record<string, unknown> }[] = [];
  for (const c of calls) {
    let v: unknown;
    try { v = JSON.parse(c.function.arguments); } catch { return null; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    out.push({ id: c.id, name: c.function.name, input: v as Record<string, unknown> });
  }
  return out;
}
export interface ChatClientLike {
  chat: { completions: { create(params: unknown, options: { signal: AbortSignal }): Promise<unknown> } };
}

export class ChatCompletionsSession implements LlmSession {
  private readonly messages: unknown[];
  private tokensOut = 0;

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
    const body: Record<string, unknown> = {
      model: this.o.model, messages: this.messages, max_tokens: Math.max(1, Math.min(TURN_CAP, this.o.maxOutputTokens - this.tokensOut)),
      tools: this.o.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
    };
    // GLM's default effort is "max" and spends the request on thinking, so the answer is cut off. "high" still reasons.
    if (this.o.provider === 'zai') body['reasoning_effort'] = 'high';
    return body;
  }

  private async turn(): Promise<LlmTurn> {
    const usage = { in: 0, out: 0 };
    let text = '';
    try {
      for (let extra = 0; ; extra++) {
        const r = (await this.client.chat.completions.create(this.params(), { signal: this.o.signal })) as ChatResponse;
        const choice = r.choices[0];
        usage.in += r.usage?.prompt_tokens ?? 0;
        usage.out += r.usage?.completion_tokens ?? 0;
        this.tokensOut += r.usage?.completion_tokens ?? 0;
        if (!choice) return { text, toolCalls: [], stop: 'error', usage, detail: 'the provider answered no choice' };
        const part = choice.message.content ?? '';
        if (choice.message.refusal || choice.finish_reason === 'content_filter') {
          this.messages.push(choice.message);
          return { text: text + part, toolCalls: [], stop: 'refusal', usage, detail: choice.message.refusal ?? 'the model declined' };
        }
        const calls = finishedToolCalls(choice.message);
        if (choice.finish_reason === 'length' && !calls?.length) {
          const kept: ChatMessage = { ...choice.message, content: part };
          delete kept.tool_calls;   // a half-written call would make the next request illegal
          this.messages.push(kept);
          text += part;
          if (this.tokensOut >= this.o.maxOutputTokens || extra >= MAX_CONTINUATIONS) return { text, toolCalls: [], stop: 'max_tokens', usage };
          this.messages.push({ role: 'user', content: CONTINUE });
          continue;
        }
        this.messages.push(choice.message);   // unchanged (thought signatures, reasoning_content)
        text += part;
        if (choice.finish_reason === 'length') return { text, toolCalls: calls ?? [], stop: 'tool', usage };
        const toolCalls = calls ?? (choice.message.tool_calls ?? []).filter((c) => c.type === 'function').map((c) => ({ id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }));
        return { text, toolCalls, stop: toolCalls.length ? 'tool' : 'end', usage };
      }
    } catch (e) {
      const why = openAiErrorText(e);
      if (why === null) throw e;
      return { text, toolCalls: [], stop: 'error', usage, detail: why };
    }
  }
}
