import { LlmRegistryAdapter } from '../../../../src/infrastructure/llm/llm-registry.adapter.js';
import { AnthropicLlmSession } from '../../../../src/infrastructure/llm/anthropic.llm.adapter.js';
import { OpenAiResponsesSession } from '../../../../src/infrastructure/llm/openai-responses.llm.adapter.js';
import { ChatCompletionsSession } from '../../../../src/infrastructure/llm/gemini-chat.llm.adapter.js';
import { FakeLlmSession } from '../../../../src/infrastructure/llm/fake.llm.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const env = (over: Record<string, unknown> = {}) => ({ nodeEnv: 'development', editorFakeLlm: false, llmKeys: {}, editorModels: {}, editorDefaultProvider: null, zaiBaseUrl: 'https://z.example/api/paas/v4', ...over }) as unknown as EnvService;
const o = (provider: string) => ({ provider: provider as 'fake', model: 'm', system: '', tools: [], maxOutputTokens: 1, signal: new AbortController().signal });

describe('LlmRegistryAdapter', () => {
  it('offers exactly the providers with a key, in a fixed order, with env model defaults; the fake only in tests or with EDITOR_FAKE_LLM', () => {
    expect(new LlmRegistryAdapter(env()).enabled()).toEqual([]);
    const all = new LlmRegistryAdapter(env({ llmKeys: { anthropic: 'k', openai: 'k', gemini: 'k', zai: 'k' }, editorModels: { anthropic: 'claude-sonnet-5-5', zai: 'glm-x' }, editorFakeLlm: true }));
    expect(all.enabled().map((p) => [p.id, p.default])).toEqual([['anthropic', 'claude-sonnet-5-5'], ['openai', 'gpt-6'], ['gemini', 'gemini-3.1-pro-preview'], ['zai', 'glm-x'], ['fake', 'scripted']]);
    expect(all.enabled()[0]!.models).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);
    expect(new LlmRegistryAdapter(env({ nodeEnv: 'test' })).enabled().map((p) => p.id)).toEqual(['fake']);
  });

  it('preferred = EDITOR_DEFAULT_PROVIDER only when enabled; open builds the right session and refuses a provider that is off', () => {
    const r = new LlmRegistryAdapter(env({ llmKeys: { anthropic: 'k', openai: 'k', gemini: 'k', zai: 'k' }, editorDefaultProvider: 'gemini', editorFakeLlm: true }));
    expect(r.preferred()).toBe('gemini');
    expect(new LlmRegistryAdapter(env({ editorDefaultProvider: 'gemini' })).preferred()).toBeNull();
    expect(r.open(o('anthropic'))).toBeInstanceOf(AnthropicLlmSession);
    expect(r.open(o('zai'))).toBeInstanceOf(ChatCompletionsSession);
    expect(r.open(o('openai'))).toBeInstanceOf(OpenAiResponsesSession);
    expect(r.open(o('gemini'))).toBeInstanceOf(ChatCompletionsSession);
    expect(r.open(o('fake'))).toBeInstanceOf(FakeLlmSession);
    expect(() => new LlmRegistryAdapter(env()).open(o('anthropic'))).toThrow(/not enabled/);
  });
});
