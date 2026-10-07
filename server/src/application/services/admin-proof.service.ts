import { Injectable } from '@nestjs/common';
import { adminActionChallenge, adminActionKey, describesIntent, type AdminIntent, type AdminProof } from '../../domain/admin/admin-proof.js';
import { UnauthorizedError } from '../../domain/shared/errors.js';
import { ChallengeRepositoryPort } from '../ports/auth/challenge.repository.port.js';
import { SignatureVerifierPort } from '../ports/auth/signature-verifier.port.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EntropyPort } from '../ports/shared/entropy.port.js';

const NONCE_BYTES = 16;

/**
 * Signed admin actions (domain/admin/admin-proof.ts): `issue` stores the text describing one change for the admin's wallet to sign (one pending per admin –
 * a new one replaces it); `prove` consumes it – single use, pass or fail – and checks it is unexpired, describes exactly the requested change and carries
 * the admin's signature. Anything else is a 401 and the change does not happen.
 */
@Injectable()
export class AdminProofService {
  constructor(
    private readonly challenges: ChallengeRepositoryPort,
    private readonly verifier: SignatureVerifierPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async issue(wallet: string, intent: AdminIntent): Promise<string> {
    const rules = this.rules.get();
    const challenge = adminActionChallenge({ wallet, domain: rules.adminDomain, intent, nonce: this.entropy.hex(NONCE_BYTES), now: this.clock.now(), ttlMs: rules.nonceTtlMs });
    await this.challenges.upsert(challenge);
    return challenge.message;
  }

  async prove(wallet: string, intent: AdminIntent, signature: string): Promise<AdminProof> {
    const challenge = await this.challenges.consume(adminActionKey(wallet));
    if (!challenge || challenge.isExpired(this.clock.now())) throw new UnauthorizedError('no signed request for this change – sign it again');
    if (!describesIntent(challenge.message, this.rules.get().adminDomain, wallet, intent)) throw new UnauthorizedError('the signed text describes another change – sign this one');
    if (!this.verifier.verify(challenge.message, signature, wallet)) throw new UnauthorizedError('bad signature');
    return { message: challenge.message, signature };
  }
}
