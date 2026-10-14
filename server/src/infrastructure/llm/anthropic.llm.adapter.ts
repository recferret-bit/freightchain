import Anthropic from '@anthropic-ai/sdk';
import type { LlmOpenOptions, LlmSession, LlmToolResult, LlmTurn } from '../../application/ports/editor/llm-provider.port.js';

/* Claude through the Messages API (and z.ai's Anthropic-compatible endpoint with `compat`). A manual tool loop: every turn streams one message
   (`messages.stream(…).finalMessage()` – no HTTP timeouts on long thinking), the assistant content is appended to the history UNCHANGED (adaptive
   thinking blocks must go back as they came), tool results go back as ONE user message. Prompt caching: the system prompt is one cached text block
   and the LAST tool definition carries cache_control (tools are sorted by the caller, so the prefix is stable). */

/** models on the official API that take the server-side refusal fallback (beta) */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_PAUSES = 4;

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown };
type Message = { content: Block[]; stop_reason: string | null; stop_details?: { category?: string | null } | null; usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } };
/** the slice of the SDK client this adapter uses (a test passes a fake) */
export interface AnthropicClientLike {
  messages: { stream(params: unknown, options: { signal: AbortSignal }): { finalMessage(): Promise<unknown> } };
  beta: { messages: { stream(params: unknown, options: { signal: AbortSignal }): { finalMessage(): Promise<unknown> } } };
}

/** a provider error as a sentence for the chat – by the SDK's error classes, never by parsing messages (and never with a key in it) */
export function anthropicErrorText(e: unknown): string | null {
  if (e instanceof Anthropic.APIUserAbortError) return null;   // our own abort: the caller decides what it was
  if (e instanceof Anthropic.AuthenticationError) return 'the provider refused the API key';
  if (e instanceof Anthropic.PermissionDeniedError) return 'the API key may not use this model';
  if (e instanceof Anthropic.NotFoundError) return 'the provider does not know this model';
  if (e instanceof Anthropic.RateLimitError) return 'rate limited by the provider – try again in a minute';
  if (e instanceof Anthropic.BadRequestError) return 'the provider rejected the request (400)';
  if (e instanceof Anthropic.InternalServerError) return 'the provider had an internal error';
  if (e instanceof Anthropic.APIConnectionError) return 'could not reach the provider';
  if (e instanceof Anthropic.APIError) return `the provider answered ${e.status ?? 'an error'}`;
  return null;
}

export class AnthropicLlmSession implements LlmSession {
  private readonly messages: { role: 'user' | 'assistant'; content: unknown }[] = [];

  constructor(private readonly client: AnthropicClientLike, private readonly o: LlmOpenOptions, private readonly compat: boolean) {}

  send(text: string): Promise<LlmTurn> {
    this.messages.push({ role: 'user', content: text });
    return this.turn();
  }

  sendToolResults(results: readonly LlmToolResult[]): Promise<LlmTurn> {
    this.messages.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, is_error: r.isError })) });
    return this.turn();
  }

  /** the request of one turn (exported shape for the unit spec) */
  params(): Record<string, unknown> {
    const last = this.o.tools.length - 1;
    const params: Record<string, unknown> = {
      model: this.o.model, max_tokens: this.o.maxOutputTokens,
      system: [{ type: 'text', text: this.o.system, cache_control: { type: 'ephemeral' } }],
      tools: this.o.tools.map((t, i) => ({ name: t.name, description: t.description, input_schema: t.inputSchema, ...(i === last ? { cache_control: { type: 'ephemeral' } } : {}) })),
      tool_choice: { type: 'auto' },   // a forced tool choice is a 400 with adaptive thinking
      messages: this.messages,
    };
    if (!this.compat) { params['thinking'] = { type: 'adaptive' }; params['output_config'] = { effort: 'high' }; }
    return params;
  }

  private async call(): Promise<Message> {
    const options = { signal: this.o.signal };
    if (!this.compat && FALLBACK_MODELS.has(this.o.model)) return (await this.client.beta.messages.stream({ ...this.params(), betas: [FALLBACK_BETA], fallbacks: 'default' }, options).finalMessage()) as Message;
    return (await this.client.messages.stream(this.params(), options).finalMessage()) as Message;
  }

  private async turn(): Promise<LlmTurn> {
    const usage = { in: 0, out: 0 };
    let text = '';
    try {
      for (let pause = 0; ; pause++) {
        const m = await this.call();
        usage.in += m.usage.input_tokens + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0);
        usage.out += m.usage.output_tokens;
        this.messages.push({ role: 'assistant', content: m.content });   // unchanged, thinking blocks included
        text += m.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
        if (m.stop_reason === 'pause_turn' && pause < MAX_PAUSES) continue;   // a long server-side turn: send it back as it is and let it go on
        if (m.stop_reason === 'refusal') return { text, toolCalls: [], stop: 'refusal', usage, detail: `the model declined${m.stop_details?.category ? ` (${m.stop_details.category})` : ''}` };
        if (m.stop_reason === 'max_tokens') return { text, toolCalls: [], stop: 'max_tokens', usage };
        const toolCalls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id ?? '', name: b.name ?? '', input: (b.input ?? {}) as Record<string, unknown> }));
        return { text, toolCalls, stop: toolCalls.length ? 'tool' : 'end', usage };
      }
    } catch (e) {
      const why = anthropicErrorText(e);
      if (why === null) throw e;   // an abort (cancel / timeout) or a bug: the agent handles it
      return { text, toolCalls: [], stop: 'error', usage, detail: why };
    }
  }
}

export function anthropicClient(apiKey: string, baseURL?: string): AnthropicClientLike {
  return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), maxRetries: 2 }) as unknown as AnthropicClientLike;
}
