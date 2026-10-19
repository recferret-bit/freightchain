import { EFFECTS, type EffectId } from './live-rules.js';

/** The live-streams feature flags as configured (server env LIVE_*; docs/tech/configuration.md). 'free' = only on free test rides, never on paid ones. */
export interface LiveFlags {
  chat: 'all' | 'free' | 'off';
  donations: boolean;
  /** true = MOCK donations (nothing charged); false = a real SOL transfer from the spectator to the driver, verified on chain */
  freeDonations: boolean;
  effects: 'all' | 'free' | 'off';
}

/** What a spectator may do on ONE ride – the server enforces it, and the watch page / the driver's CB only read this (one truth). */
export interface LiveFeaturesDto {
  chat: boolean;
  donations: boolean;
  /** how a donation is paid: 'mock' = nothing is charged · 'chain' = a SOL transfer to the driver's wallet the server verifies */
  payment: 'mock' | 'chain';
  /** donations that change the ride (night / day / holes); false = tips only */
  effects: boolean;
}

export function liveFeatures(flags: LiveFlags, ride: { isFree: boolean; ranked?: boolean }): LiveFeaturesDto {
  if (ride.isFree) return { chat: false, donations: false, payment: 'mock', effects: false };
  const donations = flags.donations;
  return { chat: flags.chat === 'all', donations, payment: flags.freeDonations ? 'mock' : 'chain', effects: donations && flags.effects === 'all' && !ride.ranked };
}

/** null = allowed; otherwise why not (the 403's text). `honk-time` and `honk-weather` are TEN4 burns, not donations: the ride checks already ran, and the donation effect switch does not gate them. */
export function refusalFor(features: LiveFeaturesDto, input: { kind: 'message' } | { kind: 'donation'; effect: EffectId } | { kind: 'honk-time' } | { kind: 'honk-weather' }): string | null {
  if (input.kind === 'message') return features.chat ? null : 'chat is off on this ride';
  if (input.kind === 'honk-time' || input.kind === 'honk-weather') return null;
  if (!features.donations) return 'donations are off';
  if (EFFECTS[input.effect].game && !features.effects) return 'effects are off on this ride – a tip still works';
  return null;
}
