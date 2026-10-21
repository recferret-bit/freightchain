import { BadRequestError, ConflictError, NotFoundError } from '../shared/errors.js';

export const APPEAL_STATUSES = ['open', 'upheld', 'denied'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export interface RideAppealRecord {
  id: string;
  rideId: string;
  wallet: string;
  poolId: number;
  reason: string;
  status: AppealStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolution: string | null;
}

/** A pool ride may be appealed only when its verdict is rejected or flagged, inside [play close, validation end]. */
export function appealRefusal(input: {
  own: boolean;
  poolId: number | null;
  rideStatus: string;
  verdict: string | null;
  now: Date;
  playCloseAt: Date;
  validationUntil: Date;
  reason: string;
}): string | null {
  if (!input.own) return 'not_found';
  if (input.poolId === null) return 'appeal_not_allowed';
  if (input.rideStatus !== 'completed') return 'appeal_not_allowed';
  if (input.verdict !== 'rejected' && input.verdict !== 'flagged' && input.verdict !== 'flagged_for_review') return 'appeal_not_allowed';
  if (input.now.getTime() < input.playCloseAt.getTime() || input.now.getTime() > input.validationUntil.getTime()) return 'appeal_closed';
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) return 'bad_reason';
  return null;
}

export function appealError(code: string): Error {
  if (code === 'not_found') return new NotFoundError('ride not found');
  if (code === 'bad_reason') return new BadRequestError('an appeal reason is 1–500 characters', 'bad_reason');
  if (code === 'appeal_closed') return new ConflictError('appeals are open from play close until validation ends', 'appeal_closed');
  return new ConflictError('this ride cannot be appealed', 'appeal_not_allowed');
}

export function openAppeal(input: { id: string; rideId: string; wallet: string; poolId: number; reason: string; now: Date }): RideAppealRecord {
  return {
    id: input.id, rideId: input.rideId, wallet: input.wallet, poolId: input.poolId, reason: input.reason.trim(), status: 'open',
    createdAt: input.now, resolvedAt: null, resolvedBy: null, resolution: null,
  };
}

export function resolveAppeal(row: RideAppealRecord, decision: Extract<AppealStatus, 'upheld' | 'denied'>, by: string, note: string | null, now: Date): RideAppealRecord {
  if (row.status !== 'open') throw new ConflictError(`appeal is ${row.status}`, 'appeal_closed');
  return { ...row, status: decision, resolvedBy: by, resolvedAt: now, resolution: note };
}
