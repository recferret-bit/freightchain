import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { EDITOR_SIGNIN_STATEMENT, editorAnonymousChallenge, editorSignInChallenge } from '../../../../domain/admin/admin-proof.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import type { ChallengeDto } from '../../auth/request-challenge/request-challenge.command.js';
import { RequestEditorChallengeCommand } from './request-editor-challenge.command.js';

const NONCE_BYTES = 16;

/** Step 1 of the editor sign-in (storybook.<apex>). With a wallet: the message for an EDITOR_WALLETS address, anyone else 404.
 *  Without one: a 1-click challenge (the address is filled in by the wallet). The allowlist is checked when the signature comes back. */
@CommandHandler(RequestEditorChallengeCommand)
export class RequestEditorChallengeHandler implements ICommandHandler<RequestEditorChallengeCommand, ChallengeDto> {
  constructor(
    private readonly challenges: ChallengeRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute(command: RequestEditorChallengeCommand): Promise<ChallengeDto> {
    const rules = this.rules.get();
    const nonce = this.entropy.hex(NONCE_BYTES);
    const now = this.clock.now();
    if (!command.wallet) {
      const challenge = editorAnonymousChallenge({ domain: rules.editorDomain, origin: rules.editorOrigin, nonce, now, ttlMs: rules.nonceTtlMs });
      await this.challenges.upsert(challenge);
      return {
        message: challenge.message, domain: rules.editorDomain, statement: EDITOR_SIGNIN_STATEMENT, uri: rules.editorOrigin,
        version: '1', chainId: 'solana:devnet', nonce, issuedAt: now.toISOString(), expirationTime: challenge.expiresAt.toISOString(),
      };
    }
    const wallet = parseWalletAddress(command.wallet);
    if (!rules.editorWallets.has(wallet)) throw new NotFoundError('not found');
    const challenge = editorSignInChallenge({ wallet, domain: rules.editorDomain, origin: rules.editorOrigin, nonce, now, ttlMs: rules.nonceTtlMs });
    await this.challenges.upsert(challenge);
    return { message: challenge.message };
  }
}
