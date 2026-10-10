/** One anonymous offline free ride that was started. The fingerprint is the browser's; the IP is the server's. */
export interface OfflineClaimInput {
  id: string;
  fingerprint: string;
  ip: string;
  at: Date;
  limitFingerprint: number;
  limitIp: number;
}

export interface OfflineClaimResult {
  granted: boolean;
  usedFingerprint: number;
  usedIp: number;
}

/** Counts are a point-in-time read. `tryClaim` inserts at most one row and is the only place that spends a credit. */
export abstract class OfflineRideRepositoryPort {
  abstract counts(fingerprint: string, ip: string): Promise<{ usedFingerprint: number; usedIp: number }>;
  abstract tryClaim(input: OfflineClaimInput): Promise<OfflineClaimResult>;
}
