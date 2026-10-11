import { AuthChallenge } from '../../../domain/auth/auth-challenge.entity.js';

export abstract class ChallengeRepositoryPort {
  /** One pending challenge per key (wallet address or `nonce:${nonce}`): a new one replaces the old. */
  abstract upsert(challenge: AuthChallenge): Promise<void>;
  /** Atomically delete-and-return the pending challenge: single use – a second concurrent verify gets null. */
  abstract consume(key: string): Promise<AuthChallenge | null>;

  /** Convenience method for consuming 1-click challenges by nonce */
  consumeByNonce(nonce: string): Promise<AuthChallenge | null> {
    return this.consume(AuthChallenge.nonceKey(nonce));
  }
}
