import { MG_RULES_VERSION, MG_SALT_VERSION, MINIGAME_ACCEPTED, MINIGAME_KINDS } from '../shared/index.js';

/** Keep equal to client/shared/minigame-kinds.js (re-exported here). Only phone-sms is issued. */
export const KNOWN_KINDS: readonly string[] = MINIGAME_KINDS;
export const ACCEPTED_KINDS: readonly string[] = MINIGAME_ACCEPTED;
export const MG_RULES = MG_RULES_VERSION;
export const MG_SALT = MG_SALT_VERSION;

export const isAcceptedKind = (kind: string): boolean => (ACCEPTED_KINDS as readonly string[]).includes(kind);

/** Config may name a disabled kind. Those are skipped and never scheduled. */
export function issuedKinds(requested: readonly string[]): string[] {
  return requested.filter(isAcceptedKind);
}

export type MgMode = 'normal' | 'more-time';
export type MgLang = 'en' | 'ru';
export type MgRunMode = 'off' | 'shadow' | 'enforce';

export const WINDOW_MS: Record<MgMode, number> = { normal: 30_000, 'more-time': 60_000 };

/** Code entry. A later correct try is still a pass. Penalty only when every try is wrong. */
export const CODE_ATTEMPTS = 3;
export const CODE_PENALTY_S = 20;
/** Decision games (not issued in v1) get one try and no time penalty. */
export const DECISION_ATTEMPTS = 1;
