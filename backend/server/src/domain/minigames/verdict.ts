import type { VerdictReason } from '../verdict/verdict.dto.js';
import type { MgRunMode } from './kinds.js';

export interface MinigameVerdictEvent {
  id: string;
  /** The client's safe-stop claim recorded at open. false = opened anyway. */
  clientSafe: boolean | null;
}

export interface MinigameVerdictInput {
  mode: MgRunMode;
  events: readonly MinigameVerdictEvent[];
}

/**
 * Minigames never fail a ride. Off and shadow add nothing. Enforce may flag an open the client called unsafe.
 * Returns [] unless mode is enforce.
 */
export function minigameVerdictDelta(input: MinigameVerdictInput): VerdictReason[] {
  if (input.mode !== 'enforce') return [];
  return input.events
    .filter((e) => e.clientSafe === false)
    .map((e) => ({ code: 'mg-unsafe-open', detail: `minigame ${e.id} was opened while the client reported an unsafe stop`, severity: 'flag' as const }));
}
