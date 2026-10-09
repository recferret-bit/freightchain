import type { SignInRecord } from '../../../domain/auth/sign-in.js';

export abstract class SignInRepositoryPort {
  abstract insert(record: SignInRecord): Promise<void>;
  /** newest first; `wallet` narrows to one rider */
  abstract recent(limit: number, wallet?: string): Promise<SignInRecord[]>;
  abstract countSince(at: Date): Promise<number>;
  /** Retention: deletes the rows older than `cutoff` (they hold IP addresses). Returns how many. */
  abstract deleteBefore(cutoff: Date): Promise<number>;
}
