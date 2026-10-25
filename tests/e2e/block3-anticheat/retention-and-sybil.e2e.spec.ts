import { describe, expect, it } from 'vitest';
import { INP_RETAIN_MS, inpPrunable } from '../../../backend/server/src/domain/anticheat/inp-retention.js';
import { TRACE_SIMILARITY_THRESHOLD, clusterAlert, flagSimilarTraces } from '../../../backend/server/src/domain/anticheat/trace-cluster.js';
import { GRANT_HOLD_MS, applyTrust, grantReleasable } from '../../../backend/server/src/domain/anticheat/trust-score.js';

const now = new Date('2026-10-22T00:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const intervals = Array.from({ length: 20 }, (_, i) => 100 + (i % 7) * 13);

describe('ACH-T-04 retention and sybil', () => {
  it('ACH-T-04 two wallets with the same 20 intervals are flagged', () => {
    const flags = flagSimilarTraces([
      { rideId: 'ride-a', wallet: 'wallet-a', intervalsMs: intervals },
      { rideId: 'ride-b', wallet: 'wallet-b', intervalsMs: intervals },
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.similarity).toBeGreaterThanOrEqual(0.85);
    expect(flags[0]?.similarity).toBeGreaterThanOrEqual(TRACE_SIMILARITY_THRESHOLD);
    const alert = clusterAlert(flags);
    expect(alert).not.toBeNull();
    expect(alert?.code).toBe('trace-cluster');
  });

  it('ACH-T-04 the same wallet twice is not flagged', () => {
    const flags = flagSimilarTraces([
      { rideId: 'ride-a', wallet: 'wallet-a', intervalsMs: intervals },
      { rideId: 'ride-b', wallet: 'wallet-a', intervalsMs: intervals },
    ]);
    expect(flags).toEqual([]);
    expect(clusterAlert(flags)).toBeNull();
  });

  it('ACH-T-04 inp without a finalized payout is not prunable', () => {
    expect(INP_RETAIN_MS).toBe(90 * 24 * 60 * 60 * 1000);
    expect(inpPrunable({ rideId: 'ride-a', inpAt: daysAgo(200), payoutFinalizedAt: null }, now)).toBe(false);
  });

  it('ACH-T-04 inp 91 days old with a finalized payout is prunable', () => {
    expect(inpPrunable({ rideId: 'ride-a', inpAt: daysAgo(91), payoutFinalizedAt: daysAgo(1) }, now)).toBe(true);
  });

  it('ACH-T-04 inp 10 days old with a finalized payout is not prunable', () => {
    expect(inpPrunable({ rideId: 'ride-a', inpAt: daysAgo(10), payoutFinalizedAt: daysAgo(1) }, now)).toBe(false);
  });

  it('ACH-T-04 social trust and the 48h grant hold', () => {
    expect(applyTrust(60, 'social')).toBe(65);
    const heldAt = new Date('2026-01-01T00:00:00.000Z');
    const base = { heldAt, trustA: 60, trustB: 60, rejectedA: 0, rejectedB: 0 };
    expect(GRANT_HOLD_MS).toBe(48 * 60 * 60 * 1000);
    expect(grantReleasable({ ...base, now: new Date(heldAt.getTime() + GRANT_HOLD_MS - 1) })).toBe(false);
    expect(grantReleasable({ ...base, now: new Date(heldAt.getTime() + GRANT_HOLD_MS) })).toBe(true);
  });

  it('ACH-T-04 applyTrust is only the legal events', () => {
    expect(applyTrust.length).toBe(2);
    expect(applyTrust(60, 'verified')).toBe(65);
    expect(applyTrust(60, 'rejected')).toBe(45);
    expect(applyTrust(60, 'social')).toBe(65);
  });
});
