import { ChatCompletionsSession, type ChatClientLike } from '../../../../src/infrastructure/llm/gemini-chat.llm.adapter.js';
import type { LlmOpenOptions } from '../../../../src/application/ports/editor/llm-provider.port.js';

const opts: LlmOpenOptions = { provider: 'gemini', model: 'gemini-3.1-pro-preview', system: 'SYS', tools: [{ name: 'a', description: 'A', inputSchema: { type: 'object' } }], maxOutputTokens: 900, signal: new AbortController().signal };
function fake(answers: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  return { calls, client: { chat: { completions: { create: async (p: unknown) => { calls.push(structuredClone(p) as Record<string, unknown>); return answers.shift(); } } } } as ChatClientLike };
}

describe('ChatCompletionsSession', () => {
  it('Chat Completions: system first, function tools; the assistant message (thought signature) goes back as it came; results as role tool', async () => {
    const assistant = { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'a', arguments: '{"k":"v"}' }, extra_content: { google: { thought_signature: 'TS' } } }] };
    const { calls, client } = fake([{ choices: [{ message: assistant, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 4, completion_tokens: 2 } }, { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }]);
    const s = new ChatCompletionsSession(client, opts);
    expect(await s.send('go')).toEqual({ text: '', toolCalls: [{ id: 'c1', name: 'a', input: { k: 'v' } }], stop: 'tool', usage: { in: 4, out: 2 } });
    expect(calls[0]).toMatchObject({ model: 'gemini-3.1-pro-preview', max_tokens: 900, tools: [{ type: 'function', function: { name: 'a' } }] });
    expect(calls[0]).not.toHaveProperty('reasoning_effort');
    expect(await s.sendToolResults([{ id: 'c1', content: 'r', isError: false }])).toMatchObject({ text: 'ok', stop: 'end' });
    expect(calls[1]!['messages']).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'go' }, assistant, { role: 'tool', tool_call_id: 'c1', content: 'r' }]);
    expect(calls[1]!['max_tokens']).toBe(898);
  });

  it('z.ai (GLM): the assistant message keeps its reasoning_content on the way back', async () => {
    const assistant = { role: 'assistant', content: '', reasoning_content: 'thinking…', tool_calls: [{ id: 'call_-7', index: 0, type: 'function', function: { name: 'a', arguments: '{"id": "bush"}' } }] };
    const { calls, client } = fake([{ choices: [{ message: assistant, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 161, completion_tokens: 38 } }, { choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] }]);
    const s = new ChatCompletionsSession(client, { ...opts, provider: 'zai', model: 'glm-5.2' });
    expect(await s.send('go')).toEqual({ text: '', toolCalls: [{ id: 'call_-7', name: 'a', input: { id: 'bush' } }], stop: 'tool', usage: { in: 161, out: 38 } });
    await s.sendToolResults([{ id: 'call_-7', content: 'r', isError: false }]);
    expect((calls[1]!['messages'] as unknown[])[2]).toEqual(assistant);
    expect(calls[0]).toMatchObject({ reasoning_effort: 'high' });
  });

  it('a reply cut off for length is continued; a finished tool call is kept', async () => {
    const cut = { role: 'assistant', content: 'The validator enforces', reasoning_content: 'thinking', tool_calls: [{ id: 'c', type: 'function', function: { name: 'a', arguments: '{"id":' } }] };
    const done = { role: 'assistant', content: ' four wheels.', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'a', arguments: '{"id":"bush"}' } }] };
    const { calls, client } = fake([
      { choices: [{ message: cut, finish_reason: 'length' }], usage: { prompt_tokens: 37057, completion_tokens: 1690 } },
      { choices: [{ message: done, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
    ]);
    const s = new ChatCompletionsSession(client, { ...opts, provider: 'zai', model: 'glm-5.2', maxOutputTokens: 100_000 });
    expect(await s.send('go')).toEqual({ text: 'The validator enforces four wheels.', toolCalls: [{ id: 'c2', name: 'a', input: { id: 'bush' } }], stop: 'tool', usage: { in: 37157, out: 1710 } });
    const sent = calls[1]!['messages'] as { role: string; content?: string; tool_calls?: unknown }[];
    expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(sent[2]).toMatchObject({ content: 'The validator enforces', reasoning_content: 'thinking' });
    expect(sent[2]!.tool_calls).toBeUndefined();
    expect(sent[3]!.content).toMatch(/cut off/);
    expect(calls[1]!['max_tokens']).toBe(32_768);
    const kept = { role: 'assistant', content: 'ok', tool_calls: [{ id: 'c3', type: 'function', function: { name: 'a', arguments: '{"id":"bush"}' } }] };
    const once = new ChatCompletionsSession(fake([{ choices: [{ message: kept, finish_reason: 'length' }], usage: { completion_tokens: 10 } }]).client, { ...opts, maxOutputTokens: 100_000 });
    expect(await once.send('go')).toMatchObject({ stop: 'tool', toolCalls: [{ id: 'c3', input: { id: 'bush' } }] });
  });

  it('length → max_tokens, content_filter → refusal, no choice → error', async () => {
    const { client } = fake([{ choices: [{ message: { role: 'assistant', content: 'x' }, finish_reason: 'length' }], usage: { completion_tokens: 900 } }, { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }] }, { choices: [] }]);
    const s = new ChatCompletionsSession(client, opts);
    expect((await s.send('a')).stop).toBe('max_tokens');
    expect((await s.send('b')).stop).toBe('refusal');
    expect((await s.send('c')).stop).toBe('error');
  });
});
