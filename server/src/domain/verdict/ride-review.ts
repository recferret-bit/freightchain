import { VerdictStatus } from './verdict.dto.js';

/*
 * The REVIEW of a paid ride – what the rider is told about whether the ride can win money. It is DERIVED from the verdict on every read; nothing new is
 * stored. Every completed PAID ride goes through review before prizes are paid:
 *   - no verdict yet (judging failed after /end, or has not run)        → under_review
 *   - verified – by the machine checks or by an admin's decision       → accepted
 *   - rejected by an admin's decision                                  → rejected
 *   - flagged, pending or REJECTED BY THE MACHINE (no admin decision)  → under_review: a machine reject is not final for the player – an admin looks at
 *     every such ride on the admin page (the review queue) and decides (the signed override).
 * Free rides have no review (null), and neither has a paid ride that did not complete (abandoned / failed / still running): it ranks nowhere, so there
 * is nothing to review – the outcome (FAILED · …) is all the rider sees, as before.
 * Independent of VERDICT_ENFORCE: in shadow mode the boards rank every completed shift, but the label still says whether a human has to look first.
 * Who may see it: whoever may see the verdict (the ride's owner – GET /api/rides/:id, the lobby profile); never the public feeds (/api/replays, watch).
 */
export type RideReview = 'accepted' | 'under_review' | 'rejected';

/** the verdict as far as the review needs it – each wire view has its own shape (VerdictDto.override, the admin row's `overridden`, the profile row) */
export interface ReviewVerdict {
  status: string;
  overridden: boolean;
}

export function reviewOf(tier: string, verdict: ReviewVerdict | null, rideStatus: string): RideReview | null {
  if (tier === 'free' || rideStatus !== 'completed') return null;
  if (!verdict) return 'under_review';
  if (verdict.status === VerdictStatus.Verified) return 'accepted';
  if (verdict.overridden && verdict.status === VerdictStatus.Rejected) return 'rejected';
  return 'under_review'; // flagged · pending · rejected by the machine checks
}
