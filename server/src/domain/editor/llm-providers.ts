/* The AI providers the model editor can use. Which ones are ON is the infrastructure's business (a key is set); this is the catalogue and the choice. */

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'zai' | 'xai' | 'fake';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  models: string[];
  default: string;
}

export const PROVIDER_ORDER: readonly ProviderId[] = ['xai', 'anthropic', 'openai', 'gemini', 'zai', 'fake'];

/** the provider + model a job runs on: the asked ones when enabled (else a 422 via the caller), defaults otherwise */
export function chooseProvider(enabled: readonly ProviderInfo[], preferred: string | null, provider?: string, model?: string): { info: ProviderInfo; model: string } | { error: string } {
  if (!enabled.length) return { error: 'no AI provider is configured on this server' };
  const info = provider ? enabled.find((p) => p.id === provider) : enabled.find((p) => p.id === preferred) ?? enabled[0];
  if (!info) return { error: `provider '${provider}' is not enabled here (enabled: ${enabled.map((p) => p.id).join(', ')})` };
  if (model && !info.models.includes(model)) return { error: `model '${model}' is not offered for ${info.id} (offered: ${info.models.join(', ')})` };
  return { info, model: model ?? info.default };
}
