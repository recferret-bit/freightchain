import type { AuthChallenge } from '../../../domain/auth/auth-challenge.entity.js';

export abstract class ChallengeRepositoryPort {
  /** One pending challenge per wallet: a new one replaces the old. */
  abstract upsert(challenge: AuthChallenge): Promise<void>;
  /** Atomically delete-and-return the wallet's challenge: single use – a second concurrent verify gets null. */
  abstract consume(wallet: string): Promise<AuthChallenge | null>;
}
