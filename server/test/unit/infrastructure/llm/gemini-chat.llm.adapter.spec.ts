import { GeminiChatSession, type ChatClientLike } from '../../../../src/infrastructure/llm/gemini-chat.llm.adapter.js';
import type { LlmOpenOptions } from '../../../../src/application/ports/editor/llm-provider.port.js';

const opts: LlmOpenOptions = { provider: 'gemini', model: 'gemini-3.1-pro-preview', system: 'SYS', tools: [{ name: 'a', description: 'A', inputSchema: { type: 'object' } }], maxOutputTokens: 900, signal: new AbortController().signal };
function fake(answers: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  return { calls, client: { chat: { completions: { create: async (p: unknown) => { calls.push(structuredClone(p) as Record<string, unknown>); return answers.shift(); } } } } as ChatClientLike };
}

describe('GeminiChatSession', () => {
  it('Chat Completions: system first, function tools; the assistant message (thought signature) goes back as it came; results as role tool', async () => {
    const assistant = { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'a', arguments: '{"k":"v"}' }, extra_content: { google: { thought_signature: 'TS' } } }] };
    const { calls, client } = fake([{ choices: [{ message: assistant, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 4, completion_tokens: 2 } }, { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }]);
    const s = new GeminiChatSession(client, opts);
    expect(await s.send('go')).toEqual({ text: '', toolCalls: [{ id: 'c1', name: 'a', input: { k: 'v' } }], stop: 'tool', usage: { in: 4, out: 2 } });
    expect(calls[0]).toMatchObject({ model: 'gemini-3.1-pro-preview', max_tokens: 900, tools: [{ type: 'function', function: { name: 'a' } }] });
    expect(await s.sendToolResults([{ id: 'c1', content: 'r', isError: false }])).toMatchObject({ text: 'ok', stop: 'end' });
    expect(calls[1]!['messages']).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'go' }, assistant, { role: 'tool', tool_call_id: 'c1', content: 'r' }]);
  });

  it('length → max_tokens, content_filter → refusal, no choice → error', async () => {
    const { client } = fake([{ choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'length' }] }, { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }] }, { choices: [] }]);
    const s = new GeminiChatSession(client, opts);
    expect((await s.send('a')).stop).toBe('max_tokens');
    expect((await s.send('b')).stop).toBe('refusal');
    expect((await s.send('c')).stop).toBe('error');
  });
});
