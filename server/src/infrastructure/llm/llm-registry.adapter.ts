import { Injectable } from '@nestjs/common';
import { LlmProviderPort, type LlmOpenOptions, type LlmSession } from '../../application/ports/editor/llm-provider.port.js';
import { PROVIDER_ORDER, type ProviderId, type ProviderInfo } from '../../domain/editor/llm-providers.js';
import { EnvService } from '../config/env.service.js';
import { AnthropicLlmSession, anthropicClient, type AnthropicClientLike } from './anthropic.llm.adapter.js';
import { FakeLlmSession } from './fake.llm.adapter.js';
import { GEMINI_BASE_URL, ChatCompletionsSession, type ChatClientLike } from './gemini-chat.llm.adapter.js';
import { OpenAiResponsesSession, openAiClient, type OpenAiResponsesClientLike } from './openai-responses.llm.adapter.js';

/* Which AI providers the model editor offers: those whose key is set (ANTHROPIC / OPENAI / GEMINI / ZAI_API_KEY), plus the scripted fake in tests.
   Model ids are env defaults (EDITOR_MODEL_<P>) – check them against the provider's model list when a provider renames one. Clients are built once,
   lazily; the keys never leave this file. */
export const DEFAULT_MODELS: Record<Exclude<ProviderId, 'fake'>, string> = { anthropic: 'claude-opus-5-5', openai: 'gpt-6', gemini: 'gemini-3.1-pro-preview', zai: 'glm-5.2' };
const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'];
const LABELS: Record<ProviderId, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', gemini: 'Google Gemini', zai: 'z.ai (GLM)', fake: 'Fake (tests)' };

@Injectable()
export class LlmRegistryAdapter extends LlmProviderPort {
  private readonly clients = new Map<ProviderId, unknown>();

  constructor(private readonly env: EnvService) {
    super();
  }

  enabled(): ProviderInfo[] {
    const keys = this.env.llmKeys, models = this.env.editorModels, out: ProviderInfo[] = [];
    for (const id of PROVIDER_ORDER) {
      if (id === 'fake') { if (this.env.nodeEnv === 'test' || this.env.editorFakeLlm) out.push({ id, label: LABELS.fake, models: ['scripted'], default: 'scripted' }); continue; }
      if (!keys[id]) continue;
      const def = models[id] ?? DEFAULT_MODELS[id];
      const list = id === 'anthropic' ? [...new Set([def, ...ANTHROPIC_MODELS])] : [def];
      out.push({ id, label: LABELS[id], models: list, default: def });
    }
    return out;
  }

  preferred(): ProviderId | null {
    const want = this.env.editorDefaultProvider;
    return want && this.enabled().some((p) => p.id === want) ? (want as ProviderId) : null;
  }

  open(o: LlmOpenOptions): LlmSession {
    if (!this.enabled().some((p) => p.id === o.provider)) throw new Error(`provider ${o.provider} is not enabled`);
    switch (o.provider) {
      case 'anthropic': return new AnthropicLlmSession(this.client('anthropic', () => anthropicClient(this.env.llmKeys.anthropic!)) as AnthropicClientLike, o);
      case 'openai': return new OpenAiResponsesSession(this.client('openai', () => openAiClient(this.env.llmKeys.openai!)) as OpenAiResponsesClientLike, o);
      case 'gemini': return new ChatCompletionsSession(this.client('gemini', () => openAiClient(this.env.llmKeys.gemini!, GEMINI_BASE_URL)) as ChatClientLike, o);
      case 'zai': return new ChatCompletionsSession(this.client('zai', () => openAiClient(this.env.llmKeys.zai!, this.env.zaiBaseUrl)) as ChatClientLike, o);
      case 'fake': return new FakeLlmSession(o);
    }
  }

  private client(id: ProviderId, make: () => unknown): unknown {
    let c = this.clients.get(id);
    if (!c) { c = make(); this.clients.set(id, c); }
    return c;
  }
}
