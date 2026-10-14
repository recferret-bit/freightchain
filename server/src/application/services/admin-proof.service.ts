import { Injectable } from '@nestjs/common';
import { adminActionChallenge, adminActionKey, describesIntent, editorActionKey, type AdminIntent, type AdminProof, type ProofSurface } from '../../domain/admin/admin-proof.js';
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

  /** surface 'editor' = the entity editor: its own host in the text, its own pending key (the caller checks EDITOR_WALLETS instead of ADMIN_WALLETS) */
  async issue(wallet: string, intent: AdminIntent, surface: ProofSurface = 'admin'): Promise<string> {
    const rules = this.rules.get();
    const challenge = adminActionChallenge({ wallet, domain: this.domain(surface), intent, nonce: this.entropy.hex(NONCE_BYTES), now: this.clock.now(), ttlMs: rules.nonceTtlMs, surface });
    await this.challenges.upsert(challenge);
    return challenge.message;
  }

  async prove(wallet: string, intent: AdminIntent, signature: string, surface: ProofSurface = 'admin'): Promise<AdminProof> {
    const challenge = await this.challenges.consume(surface === 'editor' ? editorActionKey(wallet) : adminActionKey(wallet));
    if (!challenge || challenge.isExpired(this.clock.now())) throw new UnauthorizedError('no signed request for this change – sign it again');
    if (!describesIntent(challenge.message, this.domain(surface), wallet, intent, surface)) throw new UnauthorizedError('the signed text describes another change – sign this one');
    if (!this.verifier.verify(challenge.message, signature, wallet)) throw new UnauthorizedError('bad signature');
    return { message: challenge.message, signature };
  }

  private domain(surface: ProofSurface): string {
    const rules = this.rules.get();
    return surface === 'editor' ? rules.editorDomain : rules.adminDomain;
  }
}
