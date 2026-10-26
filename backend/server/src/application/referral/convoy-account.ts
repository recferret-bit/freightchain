import { convoyPolicy, type ConvoyPolicy } from './convoy-policy.js';
import type { ReferralRecord } from '../../domain/referral/referral-rules.js';
import { campaignTasksComplete, type AirdropRow } from '../airdrop/airdrop-rules.js';
import type { ConvoyLedgerRow, ConvoyRow, ConvoyRideRow } from './convoy.repository.port.js';
import { distinctWeeks, pendingTtlMs } from './convoy-rules.js';

export interface ConvoyInviteDto {
  wallet: string; status: string; at: string; expiresAt: string; weeks: number;
  policy: ConvoyPolicy; tasksComplete: boolean; m1: boolean; m2: boolean; promo: 'granted' | 'cap_reached' | 'pending';
}
export interface ConvoyRewardDto {
  kind: string; referee: string; amount: number; paidUnits: string; state: string;
  at: string; releaseAt: string | null; signature: string | null; reason: string | null;
}
export interface ConvoyAccountDto {
  rules: ConvoyPolicy & { pendingHours: number; windowDays: number; activityDays: number };
  capacity: number; used: number; pending: number; available: number; max: number;
  referredBy: string | null; inbound: ConvoyInviteDto | null; invites: ConvoyInviteDto[];
  rewards: ConvoyRewardDto[]; hidden: boolean; legacyQualified: number; trustEligible: boolean;
}
export function tasksComplete(row: AirdropRow | null | undefined): boolean {
  return campaignTasksComplete(row ?? null);
}
export function inviteDto(row: ConvoyRow, rides: ConvoyRideRow[], tasks: boolean, promo: boolean): ConvoyInviteDto {
  return { wallet: row.referee, status: row.status, at: (row.activatedAt ?? row.boundAt).toISOString(),
    expiresAt: (row.qualifyExpiresAt ?? row.expiresAt).toISOString(),
    weeks: row.activatedAt && row.qualifyExpiresAt ? distinctWeeks(rides, row.activatedAt, row.qualifyExpiresAt) : 0,
    policy: row.policy ?? convoyPolicy(), tasksComplete: tasks, m1: !!row.m1At, m2: !!row.m2At,
    promo: promo ? 'granted' : row.activatedAt ? 'cap_reached' : 'pending' };
}
export function rewardDto(row: ConvoyLedgerRow): ConvoyRewardDto {
  return { kind: row.kind, referee: row.referee, amount: row.amount, paidUnits: String(row.paidUnits ?? 0n),
    state: row.chainState ?? 'legacy', at: row.at.toISOString(),
    releaseAt: row.chainState === 'held' ? new Date(row.at.getTime() + 48 * 3_600_000).toISOString() : null,
    signature: row.chainSignature ?? null, reason: row.capReason ?? null };
}

/** Read-only bridge: keep a still-valid historical pending deadline without extending it on retry. */
export function legacyPending(row: ReferralRecord | null | undefined, now: Date): ConvoyRow | null {
  if (row?.status !== 'pending') return null;
  const expiresAt = new Date(Math.min(row.expiresAt.getTime(), row.boundAt.getTime() + pendingTtlMs()));
  if (expiresAt < now) return null;
  return { referee: row.referee, referrer: row.referrer, status: 'pending', boundAt: row.boundAt, expiresAt, activatedAt: null, qualifyExpiresAt: null, m1At: null, m2At: null };
}
