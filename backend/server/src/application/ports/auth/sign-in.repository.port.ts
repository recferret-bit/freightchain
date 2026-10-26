import type { SignInRecord } from '../../../domain/auth/sign-in.js';

export interface SignInSummary {
  wallet: string;
  firstAt: Date;
  ips: string[];
}

export abstract class SignInRepositoryPort {
  abstract insert(record: SignInRecord): Promise<void>;
  /** newest first; `wallet` narrows to one rider */
  abstract recent(limit: number, wallet?: string): Promise<SignInRecord[]>;
  abstract countSince(at: Date): Promise<number>;
  /** Per wallet of `wallets` that has kept sign-ins: the earliest one and every distinct non-null subnet HMAC (the pool-level attention checks). */
  abstract summaryOf(wallets: readonly string[]): Promise<SignInSummary[]>;
  /** Retention: deletes the rows older than `cutoff` (wallet activity and pseudonymous subnet HMACs). Returns how many. */
  abstract deleteBefore(cutoff: Date): Promise<number>;
}
