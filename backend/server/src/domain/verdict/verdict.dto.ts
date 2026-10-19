export enum VerdictStatus {
  Pending = 'pending',
  Verified = 'verified',
  Flagged = 'flagged',
  Rejected = 'rejected',
}

/** Why a ride is not verified. `reject` = the recording is missing, broken or contradicts the ride; `flag` = it looks scripted and needs a human look. */
export interface VerdictReason {
  code: string;
  detail: string;
  severity: 'reject' | 'flag';
}

/** The wire view of a verdict (on the ride DTO; null = not judged – only completed shifts are). */
export interface VerdictDto {
  status: VerdictStatus;
  reasons: VerdictReason[];
  judgedAt: number;
  /** set when an admin decided the status by hand (the reasons stay as judged) */
  override: { by: string; at: number; note: string | null } | null;
}

/** What an admin may set a verdict to. */
export type VerdictDecision = VerdictStatus.Verified | VerdictStatus.Rejected;
