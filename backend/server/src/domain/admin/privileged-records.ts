/** A row in admin.AlertOutbox. `text` is what Telegram would show: no token, no full IP. */
export interface AlertRecord {
  id: string;
  kind: string;
  text: string;
  money: boolean;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
  requestId: string | null;
}

/** A high-risk change waiting for a second admin. `payload` is the HTTP body plus the path. */
export interface AdminProposalRecord {
  id: string;
  action: string;
  target: string;
  proposerWallet: string;
  approverWallet: string | null;
  payload: Record<string, unknown>;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  appliedAt: Date | null;
  requestId: string | null;
}

export const PROPOSAL_TTL_MS = 30 * 60 * 1000;
