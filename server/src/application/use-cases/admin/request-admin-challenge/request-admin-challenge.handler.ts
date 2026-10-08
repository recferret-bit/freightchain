import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { adminSignInChallenge } from '../../../../domain/admin/admin-proof.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import type { ChallengeDto } from '../../auth/request-challenge/request-challenge.command.js';
import { RequestAdminChallengeCommand } from './request-admin-challenge.command.js';

const NONCE_BYTES = 16;

/** Step 1 of the admin sign-in: the admin sign-in message for a wallet in ADMIN_WALLETS. Anyone else: 404 – the admin surface has nothing to probe. */
@CommandHandler(RequestAdminChallengeCommand)
export class RequestAdminChallengeHandler implements ICommandHandler<RequestAdminChallengeCommand, ChallengeDto> {
  constructor(
    private readonly challenges: ChallengeRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute(command: RequestAdminChallengeCommand): Promise<ChallengeDto> {
    const wallet = parseWalletAddress(command.wallet);
    const rules = this.rules.get();
    if (!rules.adminWallets.has(wallet)) throw new NotFoundError('not found');
    const challenge = adminSignInChallenge({
      wallet, domain: rules.adminDomain, origin: rules.adminOrigin, nonce: this.entropy.hex(NONCE_BYTES), now: this.clock.now(), ttlMs: rules.nonceTtlMs,
    });
    await this.challenges.upsert(challenge);
    return { message: challenge.message };
  }
}
