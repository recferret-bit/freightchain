import Anthropic from '@anthropic-ai/sdk';
import { AnthropicLlmSession, anthropicErrorText, type AnthropicClientLike } from '../../../../src/infrastructure/llm/anthropic.llm.adapter.js';
import type { LlmOpenOptions } from '../../../../src/application/ports/editor/llm-provider.port.js';

const opts = (over: Partial<LlmOpenOptions> = {}): LlmOpenOptions => ({ provider: 'anthropic', model: 'claude-opus-5-5', system: 'SYS', tools: [{ name: 'a', description: 'A', inputSchema: { type: 'object' } }, { name: 'b', description: 'B', inputSchema: { type: 'object' } }], maxOutputTokens: 32000, signal: new AbortController().signal, ...over });
const msg = (content: unknown[], stop_reason: string, extra: Record<string, unknown> = {}) => ({ content, stop_reason, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 }, ...extra });
/** a fake SDK client: records each request (a deep copy – history is a live array), answers the scripted messages in order */
function fakeClient(answers: unknown[]) {
  const calls: { beta: boolean; params: Record<string, unknown> }[] = [];
  const stream = (beta: boolean) => (params: unknown) => { calls.push({ beta, params: structuredClone(params) as Record<string, unknown> }); const m = answers.shift(); return { finalMessage: async () => { if (m instanceof Error) throw m; return m; } }; };
  return { calls, client: { messages: { stream: stream(false) }, beta: { messages: { stream: stream(true) } } } as AnthropicClientLike };
}

describe('AnthropicLlmSession', () => {
  it('the official API: beta stream with the refusal fallback, adaptive thinking, high effort, auto tools, cached system + last tool', async () => {
    const { calls, client } = fakeClient([msg([{ type: 'text', text: 'ok' }], 'end_turn')]);
    const turn = await new AnthropicLlmSession(client, opts()).send('hello');
    expect(turn).toEqual({ text: 'ok', toolCalls: [], stop: 'end', usage: { in: 13, out: 5 } });
    const p = calls[0]!.params;
    expect(calls[0]!.beta).toBe(true);
    expect(p).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 32000, thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, tool_choice: { type: 'auto' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    expect(p['system']).toEqual([{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
    expect((p['tools'] as Record<string, unknown>[]).map((t) => 'cache_control' in t)).toEqual([false, true]);
  });

  it('history is append-only: the assistant content (thinking included) goes back unchanged; all tool results in ONE user message', async () => {
    const thinking = { type: 'thinking', thinking: 'hmm', signature: 'SIG' };
    const { calls, client } = fakeClient([msg([thinking, { type: 'tool_use', id: 't1', name: 'a', input: { x: 1 } }, { type: 'tool_use', id: 't2', name: 'b', input: {} }], 'tool_use'), msg([{ type: 'text', text: 'done' }], 'end_turn')]);
    const s = new AnthropicLlmSession(client, opts());
    const t1 = await s.send('go');
    expect([t1.stop, t1.toolCalls]).toEqual(['tool', [{ id: 't1', name: 'a', input: { x: 1 } }, { id: 't2', name: 'b', input: {} }]]);
    await s.sendToolResults([{ id: 't1', content: 'r1', isError: false }, { id: 't2', content: 'bad', isError: true }]);
    const messages = calls[1]!.params['messages'] as { role: string; content: unknown }[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect((messages[1]!.content as unknown[])[0]).toEqual(thinking);
    expect(messages[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'r1', is_error: false }, { type: 'tool_result', tool_use_id: 't2', content: 'bad', is_error: true }]);
  });

  it('pause_turn continues by itself; refusal and max_tokens run no tools', async () => {
    const { calls, client } = fakeClient([msg([{ type: 'text', text: 'a' }], 'pause_turn'), msg([{ type: 'text', text: 'b' }], 'end_turn'),
      msg([{ type: 'tool_use', id: 't', name: 'a', input: {} }], 'refusal', { stop_details: { category: 'cyber' } }), msg([{ type: 'tool_use', id: 't', name: 'a', input: {} }], 'max_tokens')]);
    const s = new AnthropicLlmSession(client, opts());
    expect(await s.send('x')).toMatchObject({ text: 'ab', stop: 'end', usage: { in: 26, out: 10 } });
    expect(calls).toHaveLength(2);
    expect(await s.send('y')).toMatchObject({ stop: 'refusal', toolCalls: [], detail: 'the model declined (cyber)' });
    expect(await s.send('z')).toMatchObject({ stop: 'max_tokens', toolCalls: [] });
  });

  it('provider errors become a sentence by their SDK class; an abort is rethrown', async () => {
    const rate = new Anthropic.RateLimitError(429, { type: 'error' }, 'slow down', new Headers());
    const { client } = fakeClient([rate]);
    expect(await new AnthropicLlmSession(client, opts()).send('x')).toMatchObject({ stop: 'error', detail: 'rate limited by the provider – try again in a minute' });
    expect(anthropicErrorText(new Anthropic.AuthenticationError(401, {}, 'nope', new Headers()))).toBe('the provider refused the API key');
    const abort = new Anthropic.APIUserAbortError();
    await expect(new AnthropicLlmSession(fakeClient([abort]).client, opts()).send('x')).rejects.toBe(abort);
    expect(anthropicErrorText(new Error('bug'))).toBeNull();
  });
});
