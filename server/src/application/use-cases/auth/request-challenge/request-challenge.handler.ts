import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AuthChallenge } from '../../../../domain/auth/auth-challenge.entity.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { signInHost } from '../../../../domain/auth/sign-in-host.js';
import { RequestChallengeCommand, type ChallengeDto } from './request-challenge.command.js';

const NONCE_BYTES = 16;
const DEFAULT_STATEMENT = 'Sign in to Freight Chain. This request will not trigger a transaction or cost any fees.';
const SIWS_VERSION = '1';
const SOLANA_CHAIN_ID = 'solana:devnet';   // the cluster the whole product runs on (client/site/pools.js CLUSTER); mainnet changes both

/** Step 1 of Sign-In With Solana: the server builds the structured challenge, stores it, and hands it to the wallet.
 * Supports both wallet-bound challenges (legacy fallback) and anonymous 1-click challenges keyed by nonce:nonce.
 */
@CommandHandler(RequestChallengeCommand)
export class RequestChallengeHandler implements ICommandHandler<RequestChallengeCommand, ChallengeDto> {
  constructor(
    private readonly challenges: ChallengeRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute(command: RequestChallengeCommand): Promise<ChallengeDto> {
    const wallet = command.wallet ? parseWalletAddress(command.wallet) : null;
    const rules = this.rules.get();
    const { domain, uri } = signInHost(command.origin, rules);
    const nonce = this.entropy.hex(NONCE_BYTES);
    const now = this.clock.now();
    const ttlMs = rules.nonceTtlMs;
    const expiresAt = new Date(now.getTime() + ttlMs);

    const challenge = AuthChallenge.issue({
      wallet: wallet ?? undefined,
      domain,
      origin: uri,
      nonce,
      now,
      ttlMs,
      statement: DEFAULT_STATEMENT,
      version: SIWS_VERSION,
      chainId: SOLANA_CHAIN_ID,
    });

    // Key in storage by wallet if specified, or by nonce:nonce for 1-click SIWS
    await this.challenges.upsert(challenge);

    return {
      message: challenge.message,
      domain,
      statement: DEFAULT_STATEMENT,
      uri,
      version: SIWS_VERSION,
      chainId: SOLANA_CHAIN_ID,
      nonce,
      issuedAt: now.toISOString(),
      expirationTime: expiresAt.toISOString(),
      ...(wallet ? { address: wallet } : {}),
    };
  }
}
