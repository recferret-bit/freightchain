import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AuthChallenge } from '../../../../domain/auth/auth-challenge.entity.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { RequestChallengeCommand, type ChallengeDto } from './request-challenge.command.js';

const NONCE_BYTES = 16;

/** Step 1 of Sign-In With Solana: the server builds the message, stores it, and hands it to the wallet to sign. The message names the page's own host – the
    apex, or the game host (ride.<apex>, the watch page signs in there) when the request's Origin is exactly that configured origin; any other Origin gets the
    apex, so a phishing page never gets a message with its own domain in it (the wallet's domain check then warns). */
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
    const game = rules.gameOrigin !== null && rules.gameDomain !== null && command.origin === rules.gameOrigin;
    const challenge = AuthChallenge.issue({
      wallet, domain: game ? (rules.gameDomain as string) : rules.appDomain, origin: game ? (rules.gameOrigin as string) : rules.appOrigin, nonce: this.entropy.hex(NONCE_BYTES), now: this.clock.now(), ttlMs: rules.nonceTtlMs,
    });
    await this.challenges.upsert(challenge);
    return { message: challenge.message };
  }
}
