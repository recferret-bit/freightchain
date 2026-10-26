import { resolveSettings, type GameSettings } from '../settings/game-settings.js';
import { utcDay, DAY_MS } from '../shared/time.js';

/** No browser fingerprint or sign-in reward. Awards use persisted activity under the player lock. */
export const TRUST_INITIAL = 60;
export const TRUST_PAYOUT_MIN = 50;
export const GRANT_HOLD_MS = 48 * 60 * 60 * 1000;

export type TrustEvent = 'verified' | 'rejected' | 'social';

const DELTA: Record<TrustEvent, number> = { verified: 15, rejected: -15, social: 5 };

export function applyTrust(score: number, event: TrustEvent): number {
  return Math.max(0, Math.min(100, score + DELTA[event]));
}

export interface HoldParties {
  now: Date;
  heldAt: Date;
  trustA: number;
  trustB: number;
  rejectedA: number;
  rejectedB: number;
}

/** Convoy M1/M2 and airdrop TEN4 ledger credits. Both wallets must still clear the bar. */
export function grantReleasable(parties: HoldParties): boolean {
  if (parties.now.getTime() - parties.heldAt.getTime() < GRANT_HOLD_MS) return false;
  if (parties.trustA < TRUST_PAYOUT_MIN || parties.trustB < TRUST_PAYOUT_MIN) return false;
  return parties.rejectedA === 0 && parties.rejectedB === 0;
}

export type TrustSocial = 'telegram' | 'x' | 'discord';
export interface TrustActivity { finishDays: string[]; socials: TrustSocial[]; socialPoints: number }
export const emptyTrustActivity = (): TrustActivity => ({ finishDays: [], socials: [], socialPoints: 0 });
export const trustPolicy = (settings: GameSettings = resolveSettings([])) => ({ finishPoints: settings.trustFinishPoints, finishDays: settings.trustFinishDaysPerWeek, finishCap: settings.trustFinishCap, socialCap: settings.trustSocialCap });
export type TrustPolicy = ReturnType<typeof trustPolicy>;
const SOCIAL_POINTS: Record<TrustSocial, number> = { telegram: 5, x: 20, discord: 15 };
const weekOf = (day: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  return utcDay(new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS));
};
/** Historical completion days remain recorded so rejudging an older week cannot replenish its allowance. */
export function finishTrust(score: number, activity: TrustActivity, endedAt: Date, policy: TrustPolicy): { score: number; activity: TrustActivity } | null {
  const day = utcDay(endedAt), week = weekOf(day);
  if (activity.finishDays.includes(day) || activity.finishDays.filter(d => weekOf(d) === week).length >= policy.finishDays) return null;
  return { score: Math.max(score, Math.min(policy.finishCap, score + policy.finishPoints)), activity: { ...activity, finishDays: [...activity.finishDays, day].sort() } };
}
export function socialTrust(score: number, activity: TrustActivity, provider: TrustSocial, policy: TrustPolicy): { score: number; activity: TrustActivity } | null {
  if (activity.socials.includes(provider)) return null;
  const points = Math.min(SOCIAL_POINTS[provider], Math.max(0, policy.socialCap - activity.socialPoints));
  return { score: Math.min(100, score + points), activity: { ...activity, socials: [...activity.socials, provider], socialPoints: activity.socialPoints + points } };
}
