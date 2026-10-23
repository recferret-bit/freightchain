import type { PoolChainState } from './chain-events.js';

/** play close minus this is the last moment a pool ride may start (decision 36). */
export const LAST_START_MS = 75 * 60 * 1000;
/** sales close this long before play close. */
export const SALES_LEAD_MS = 2 * 60 * 60 * 1000;
/** review / appeals window after play close. validation_until = payout_at. */
export const VALIDATION_MS = 36 * 60 * 60 * 1000;
/** A ride still going this long after play close is abandoned (POOL-M-04). */
export const PLAY_GRACE_MS = 60 * 1000;
/** Server ceiling for Config.min_finish_secs. The shipped .so still defaults to 10_800 until set_config. */
export const MAX_MIN_FINISH_SECS = 7_200;

export const POOL_PHASES = ['upcoming', 'open', 'finishing', 'validating', 'paid', 'closed'] as const;
export type PoolPhase = (typeof POOL_PHASES)[number];

export interface PoolSchedule {
  opensAt: Date;
  salesCloseAt: Date;
  lastStartAt: Date;
  playCloseAt: Date;
  validationUntil: Date;
}

export interface ScheduleSource {
  createdAt: Date;
  prepDeadline: Date;
  playDeadline: Date;
  payoutAt: Date;
  opensAt?: Date | null;
  salesCloseAt?: Date | null;
  lastStartAt?: Date | null;
  playCloseAt?: Date | null;
  validationUntil?: Date | null;
}

/**
 * Play close − 75 min when that instant is at or after the pool opened.
 * A window shorter than the lead cannot hold it (a localnet pool of a few minutes): the last start is play close.
 * A week-long pool is unchanged.
 */
export function lastStartAtFor(playClose: Date, openedAt: Date): Date {
  const lead = new Date(playClose.getTime() - LAST_START_MS);
  return lead.getTime() < openedAt.getTime() ? playClose : lead;
}

/** Explicit columns win. A null column is the chain deadline it mirrors (or createdAt for opensAt, `lastStartAtFor` for last start). */
export function derivedSchedule(p: ScheduleSource): PoolSchedule {
  const playCloseAt = p.playCloseAt ?? p.playDeadline;
  return {
    opensAt: p.opensAt ?? p.createdAt,
    salesCloseAt: p.salesCloseAt ?? p.prepDeadline,
    lastStartAt: p.lastStartAt ?? lastStartAtFor(playCloseAt, p.createdAt),
    playCloseAt,
    validationUntil: p.validationUntil ?? p.payoutAt,
  };
}

/** Next Sunday `hourUtc` strictly after `from`, and the Tuesday evening of that same stretch. */
export function defaultWeeklySchedule(from: Date, hourUtc = 18): PoolSchedule {
  const playCloseAt = nextWeekdayHour(from, 0, hourUtc);
  const opensAt = new Date(playCloseAt.getTime() - 5 * 86_400_000);
  return {
    opensAt,
    salesCloseAt: new Date(playCloseAt.getTime() - SALES_LEAD_MS),
    lastStartAt: new Date(playCloseAt.getTime() - LAST_START_MS),
    playCloseAt,
    validationUntil: new Date(playCloseAt.getTime() + VALIDATION_MS),
  };
}

export function finishWindowFits(prep: Date, play: Date, minFinishSecs: number): boolean {
  return play.getTime() - prep.getTime() >= minFinishSecs * 1000;
}

/** Names the deadlines that disagree. Null columns are not drift: they mean "use the chain value". */
export function scheduleMismatch(s: ScheduleSource, chain: Pick<PoolChainState, 'createdAt' | 'prepDeadline' | 'playDeadline' | 'payoutAt'> | null): string | null {
  const play = chain?.playDeadline ?? s.playDeadline;
  const prep = chain?.prepDeadline ?? s.prepDeadline;
  const payout = chain?.payoutAt ?? s.payoutAt;
  const created = chain?.createdAt ?? s.createdAt;
  const bad: string[] = [];
  if (chain && chain.playDeadline.getTime() !== s.playDeadline.getTime()) bad.push('playCloseAt');
  if (chain && chain.prepDeadline.getTime() !== s.prepDeadline.getTime()) bad.push('salesCloseAt');
  if (chain && chain.payoutAt.getTime() !== s.payoutAt.getTime()) bad.push('validationUntil');
  if (s.playCloseAt && s.playCloseAt.getTime() !== play.getTime()) bad.push('playCloseAt');
  if (s.lastStartAt && s.lastStartAt.getTime() !== lastStartAtFor(play, created).getTime()) bad.push('lastStartAt');
  if (s.opensAt && s.opensAt.getTime() !== created.getTime()) bad.push('opensAt');
  if (s.salesCloseAt && s.salesCloseAt.getTime() !== prep.getTime()) bad.push('salesCloseAt');
  if (s.validationUntil && s.validationUntil.getTime() !== payout.getTime()) bad.push('validationUntil');
  const unique = [...new Set(bad)];
  return unique.length ? unique.join(',') : null;
}

export function schedulePhase(status: string, payoutState: string, schedule: PoolSchedule, now: Date): PoolPhase {
  if (status === 'settled' || payoutState === 'paid') return 'paid';
  if (status === 'cancelled' || status === 'refunding') return 'closed';
  const t = now.getTime();
  if (t < schedule.opensAt.getTime()) return 'upcoming';
  if (t < schedule.salesCloseAt.getTime()) return 'open';
  if (t < schedule.playCloseAt.getTime()) return 'finishing';
  if (t < schedule.validationUntil.getTime() || status === 'active' || status === 'open') return 'validating';
  return 'closed';
}

/** Why commit_winners must wait. Null = the root may be committed. */
export function commitBlockReason(now: Date, validationUntil: Date, openAppeals: number, running: number): string | null {
  if (now.getTime() < validationUntil.getTime()) return `validation is open until ${validationUntil.toISOString()}`;
  if (running > 0) return `${running} ride(s) still running`;
  if (openAppeals > 0) return `${openAppeals} appeal(s) still open`;
  return null;
}

function nextWeekdayHour(from: Date, weekday: number, hourUtc: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUtc, 0, 0, 0));
  const delta = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  if (d.getTime() <= from.getTime()) d.setUTCDate(d.getUTCDate() + 7);
  return d;
}
