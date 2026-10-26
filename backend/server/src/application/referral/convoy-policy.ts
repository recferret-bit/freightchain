import { resolveSettings, type GameSettings } from '../../domain/settings/game-settings.js';

/** Frozen when a friend activates; later settings edits never retune that friend's milestone promises. */
export type ConvoyPolicy = {
  m1Amount: number; m1Weeks: number; m2Amount: number; m2Weeks: number; minTrust: number; promoRanked: number;
};
export function convoyPolicy(s: GameSettings = resolveSettings([])): ConvoyPolicy {
  return { m1Amount: s.referralTen4M1Amount, m1Weeks: s.referralTen4M1Weeks,
    m2Amount: s.referralTen4M2Amount, m2Weeks: s.referralTen4M2Weeks,
    minTrust: s.referralMinTrustReferrer, promoRanked: s.referralRefereePromoRanked };
}
