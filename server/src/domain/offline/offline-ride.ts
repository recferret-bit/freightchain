import { FREE_COMPLETE_DIST_K, completeDist } from '../rides/ride-rules.js';

/** A blank address shares one bucket, so a missing IP cannot dodge the per-address cap. */
export const offlineIp = (ip: string | null | undefined): string => {
  const trimmed = (ip ?? '').trim();
  return (trimmed.length === 0 ? 'unknown' : trimmed).slice(0, 64);
};

export interface OfflineCounts {
  usedFingerprint: number;
  usedIp: number;
}

/** What `GET` / `POST /api/offline-rides` return. `claimed` is true only when this call inserted a row. */
export interface OfflineAllowance {
  signedIn: boolean;
  allowed: boolean;
  claimed: boolean;
  remaining: number;
  usedFingerprint: number;
  usedIp: number;
  limitFingerprint: number;
  limitIp: number;
  minSeconds: number;
  completeDist: number;
}

/** A signed-in wallet is never charged an offline credit (`allowed` and `claimed` stay false). `remaining` is the tighter of the two buckets. */
export function offlineAllowance(input: {
  signedIn: boolean;
  claimed: boolean;
  usedFingerprint: number;
  usedIp: number;
  limitFingerprint: number;
  limitIp: number;
  minSeconds: number;
}): OfflineAllowance {
  const leftFp = Math.max(0, input.limitFingerprint - input.usedFingerprint);
  const leftIp = Math.max(0, input.limitIp - input.usedIp);
  const remaining = Math.min(leftFp, leftIp);
  return {
    signedIn: input.signedIn,
    allowed: !input.signedIn && remaining > 0,
    claimed: input.claimed,
    remaining,
    usedFingerprint: input.usedFingerprint,
    usedIp: input.usedIp,
    limitFingerprint: input.limitFingerprint,
    limitIp: input.limitIp,
    minSeconds: input.minSeconds,
    completeDist: completeDist(input.minSeconds, FREE_COMPLETE_DIST_K),
  };
}
