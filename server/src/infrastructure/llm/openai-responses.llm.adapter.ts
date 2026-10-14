import OpenAI from 'openai';
import type { LlmOpenOptions, LlmSession, LlmToolResult, LlmTurn } from '../../application/ports/editor/llm-provider.port.js';

/* OpenAI through the Responses API (tool calling for current models). Stateless on OpenAI's side (store: false): the native input items are kept
   here append-only – every output item (reasoning with its encrypted content, messages, function calls) goes back unchanged, results as
   function_call_output items. */

type Item = { type: string; call_id?: string; name?: string; arguments?: string; content?: { type: string; text?: string; refusal?: string }[] };
type Response = { output: Item[]; status?: string; incomplete_details?: { reason?: string } | null; usage?: { input_tokens: number; output_tokens: number } | null };
export interface OpenAiResponsesClientLike {
  responses: { create(params: unknown, options: { signal: AbortSignal }): Promise<unknown> };
}

export function openAiErrorText(e: unknown): string | null {
  if (e instanceof OpenAI.APIUserAbortError) return null;
  if (e instanceof OpenAI.AuthenticationError) return 'the provider refused the API key';
  if (e instanceof OpenAI.PermissionDeniedError) return 'the API key may not use this model';
  if (e instanceof OpenAI.NotFoundError) return 'the provider does not know this model';
  if (e instanceof OpenAI.RateLimitError) return 'rate limited by the provider – try again in a minute';
  if (e instanceof OpenAI.BadRequestError) return 'the provider rejected the request (400)';
  if (e instanceof OpenAI.InternalServerError) return 'the provider had an internal error';
  if (e instanceof OpenAI.APIConnectionError) return 'could not reach the provider';
  if (e instanceof OpenAI.APIError) return `the provider answered ${e.status ?? 'an error'}`;
  return null;
}

export class OpenAiResponsesSession implements LlmSession {
  private readonly input: unknown[] = [];

  constructor(private readonly client: OpenAiResponsesClientLike, private readonly o: LlmOpenOptions) {}

  send(text: string): Promise<LlmTurn> {
    this.input.push({ role: 'user', content: text });
    return this.turn();
  }

  sendToolResults(results: readonly LlmToolResult[]): Promise<LlmTurn> {
    for (const r of results) this.input.push({ type: 'function_call_output', call_id: r.id, output: r.isError ? `ERROR: ${r.content}` : r.content });
    return this.turn();
  }

  params(): Record<string, unknown> {
    return {
      model: this.o.model, instructions: this.o.system, input: this.input, max_output_tokens: this.o.maxOutputTokens, store: false, include: ['reasoning.encrypted_content'],
      tools: this.o.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema, strict: false })),
    };
  }

  private async turn(): Promise<LlmTurn> {
    try {
      const r = (await this.client.responses.create(this.params(), { signal: this.o.signal })) as Response;
      for (const item of r.output) this.input.push(item);
      const usage = { in: r.usage?.input_tokens ?? 0, out: r.usage?.output_tokens ?? 0 };
      const parts = r.output.filter((i) => i.type === 'message').flatMap((i) => i.content ?? []);
      const text = parts.filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('');
      const refusal = parts.find((c) => c.type === 'refusal');
      if (refusal) return { text, toolCalls: [], stop: 'refusal', usage, detail: refusal.refusal ?? 'the model declined' };
      if (r.status === 'incomplete') return { text, toolCalls: [], stop: r.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : 'error', usage, detail: r.incomplete_details?.reason ?? 'incomplete' };
      const toolCalls = r.output.filter((i) => i.type === 'function_call').map((i) => ({ id: i.call_id ?? '', name: i.name ?? '', input: parseArgs(i.arguments) }));
      return { text, toolCalls, stop: toolCalls.length ? 'tool' : 'end', usage };
    } catch (e) {
      const why = openAiErrorText(e);
      if (why === null) throw e;
      return { text: '', toolCalls: [], stop: 'error', usage: { in: 0, out: 0 }, detail: why };
    }
  }
}

/** function-call arguments are a JSON string; a model that writes broken JSON gets an empty object (the tool's own validation answers it) */
export function parseArgs(raw: string | undefined): Record<string, unknown> {
  try { const v = JSON.parse(raw ?? '{}') as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; } catch { return {}; }
}

export function openAiClient(apiKey: string, baseURL?: string): OpenAI {
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), maxRetries: 2 });
}
