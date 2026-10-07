import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AuthChallenge } from '../../../../domain/auth/auth-challenge.entity.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { RequestChallengeCommand, type ChallengeDto } from './request-challenge.command.js';

const NONCE_BYTES = 16;

/** Step 1 of Sign-In With Solana: the server builds the message, stores it, and hands it to the wallet to sign. */
@CommandHandler(RequestChallengeCommand)
export class RequestChallengeHandler implements ICommandHandler<RequestChallengeCommand, ChallengeDto> {
  constructor(
    private readonly challenges: ChallengeRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute(command: RequestChallengeCommand): Promise<ChallengeDto> {
    const wallet = parseWalletAddress(command.wallet);
    const rules = this.rules.get();
    const challenge = AuthChallenge.issue({
      wallet, domain: rules.appDomain, origin: rules.appOrigin, nonce: this.entropy.hex(NONCE_BYTES), now: this.clock.now(), ttlMs: rules.nonceTtlMs,
    });
    await this.challenges.upsert(challenge);
    return { message: challenge.message };
  }
}
