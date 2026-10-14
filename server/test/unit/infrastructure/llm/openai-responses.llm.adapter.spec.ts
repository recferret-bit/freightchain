import OpenAI from 'openai';
import { OpenAiResponsesSession, openAiErrorText, parseArgs, type OpenAiResponsesClientLike } from '../../../../src/infrastructure/llm/openai-responses.llm.adapter.js';
import type { LlmOpenOptions } from '../../../../src/application/ports/editor/llm-provider.port.js';

const opts: LlmOpenOptions = { provider: 'openai', model: 'gpt-6', system: 'SYS', tools: [{ name: 'a', description: 'A', inputSchema: { type: 'object' } }], maxOutputTokens: 1000, signal: new AbortController().signal };
function fake(answers: unknown[]) {
  const calls: Record<string, unknown>[] = [];
  return { calls, client: { responses: { create: async (p: unknown) => { calls.push(structuredClone(p) as Record<string, unknown>); const a = answers.shift(); if (a instanceof Error) throw a; return a; } } } as OpenAiResponsesClientLike };
}

describe('OpenAiResponsesSession', () => {
  it('the Responses API: instructions, function tools, store:false + encrypted reasoning; output items go back unchanged, results as function_call_output', async () => {
    const reasoning = { type: 'reasoning', id: 'rs1', encrypted_content: 'ENC', summary: [] };
    const call = { type: 'function_call', id: 'fc1', call_id: 'c1', name: 'a', arguments: '{"x":2}' };
    const { calls, client } = fake([{ output: [reasoning, call], usage: { input_tokens: 7, output_tokens: 3 } }, { output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }], status: 'completed' }]);
    const s = new OpenAiResponsesSession(client, opts);
    expect(await s.send('go')).toEqual({ text: '', toolCalls: [{ id: 'c1', name: 'a', input: { x: 2 } }], stop: 'tool', usage: { in: 7, out: 3 } });
    expect(calls[0]).toMatchObject({ model: 'gpt-6', instructions: 'SYS', store: false, include: ['reasoning.encrypted_content'], max_output_tokens: 1000, tools: [{ type: 'function', name: 'a', parameters: { type: 'object' } }] });
    expect(await s.sendToolResults([{ id: 'c1', content: 'oops', isError: true }])).toMatchObject({ text: 'done', stop: 'end' });
    expect(calls[1]!['input']).toEqual([{ role: 'user', content: 'go' }, reasoning, call, { type: 'function_call_output', call_id: 'c1', output: 'ERROR: oops' }]);
  });

  it('a refusal, the output limit, and SDK errors by class', async () => {
    const { client } = fake([{ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, { output: [], status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, new OpenAI.RateLimitError(429, {}, 'x', new Headers())]);
    const s = new OpenAiResponsesSession(client, opts);
    expect(await s.send('a')).toMatchObject({ stop: 'refusal', detail: 'no' });
    expect(await s.send('b')).toMatchObject({ stop: 'max_tokens' });
    expect(await s.send('c')).toMatchObject({ stop: 'error', detail: 'rate limited by the provider – try again in a minute' });
    expect(openAiErrorText(new OpenAI.APIUserAbortError())).toBeNull();
    expect([parseArgs('{"a":1}'), parseArgs('broken'), parseArgs('[1]')]).toEqual([{ a: 1 }, {}, {}]);
  });
});
