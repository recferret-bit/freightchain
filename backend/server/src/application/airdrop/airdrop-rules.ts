import { levelOfTrip } from '../../domain/rides/ride-trip.js';
import { DAY_MS } from '../../domain/shared/time.js';

export const AIRDROP_CAMPAIGN = 'preseason';
export const X_MIN_AGE_DAYS = 90;
export const X_MIN_FOLLOWERS = 10;
export const X_OFFICIAL = 'FreightChainSol';
export const OFFICIAL_TELEGRAM_CHAT_ID = '@FreightChain';
const MEMBER = new Set(['creator', 'administrator', 'member']);

export interface AirdropRow {
  wallet: string;
  code: string;
  telegramUserId: string | null;
  telegramMember: boolean;
  telegramGroupMember: boolean;
  telegramActiveAt: Date | null;
  rulesAcceptedAt: Date | null;
  attemptGrantedAt: Date | null;
  points: number;
  xAttemptAt: Date | null;
  xVerifiedAt: Date | null;
  xPostId: string | null;
  xUserId: string | null;
  xHandle: string | null;
  xAgeOk: boolean;
  xFollowersOk: boolean;
  xFollows: boolean;
  xQuoteOk: boolean;
  turnstileOk: boolean;
  rideOk: boolean;
  /** Set on the first claim attempt. The ledger credit waits until this is 48 h old and trust still clears. */
  heldAt: Date | null;
  claimedAt: Date | null;
}

export function emptyAirdrop(wallet: string): AirdropRow {
  return {
    wallet, code: airdropCode(wallet), telegramGroupMember: false, telegramActiveAt: null, rulesAcceptedAt: null, attemptGrantedAt: null, points: 0, xAttemptAt: null, xVerifiedAt: null, xPostId: null, telegramUserId: null, telegramMember: false, xUserId: null, xHandle: null,
    xAgeOk: false, xFollowersOk: false, xFollows: false, xQuoteOk: false, turnstileOk: false, rideOk: false, heldAt: null, claimedAt: null,
  };
}

/** Bind the post to the complete, case-sensitive wallet; four prefix characters collide cheaply. */
export function airdropCode(wallet: string): string {
  return `FC-${wallet}`;
}

export function isMediumOrHardTrip(trip: string | null): boolean {
  const level = levelOfTrip(trip);
  return level === 2 || level === 3;
}

export function xAgeOk(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() >= X_MIN_AGE_DAYS * DAY_MS;
}

export function xFollowersOk(followers: number): boolean {
  return followers >= X_MIN_FOLLOWERS;
}

export function xQuoteOk(text: string, code: string): boolean {
  const codes: readonly string[] = text.match(/FC-[A-Za-z0-9]+/g) ?? [];
  return codes.includes(code) && /(^|[^A-Za-z0-9_])@FreightChainSol(?![A-Za-z0-9_])/i.test(text);
}

export function telegramMember(status: string, isMember?: boolean): boolean {
  return MEMBER.has(status) || (status === 'restricted' && isMember === true);
}

export function normalHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

/** Required Season 1 campaign tasks; event chat activity and legal consent are additional gates. */
export function campaignTasksComplete(row: AirdropRow | null): boolean {
  return !!row && row.rideOk && row.telegramMember && row.telegramGroupMember && row.xAgeOk && row.xFollowersOk && row.xFollows && row.xQuoteOk;
}

/** Count of completed task categories, independent of any future points allocation. */
export function campaignTaskCount(row: AirdropRow): number {
  return Number(row.rideOk) + Number(row.telegramMember && row.telegramGroupMember) + Number(row.xAgeOk && row.xFollowersOk && row.xFollows && row.xQuoteOk);
}
