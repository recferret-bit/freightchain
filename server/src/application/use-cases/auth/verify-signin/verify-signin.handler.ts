import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AuthChallenge, extractNonce, parseSignInMessage } from '../../../../domain/auth/auth-challenge.entity.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { UnauthorizedError } from '../../../../domain/shared/errors.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { SignInRepositoryPort } from '../../../ports/auth/sign-in.repository.port.js';
import { SignatureVerifierPort } from '../../../ports/auth/signature-verifier.port.js';
import { TokenSignerPort } from '../../../ports/auth/token-signer.port.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { playerSignedIn } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { MeProfileService } from '../../../services/me-profile.service.js';
import { demoScaleOf, isDemoWallet } from '../../../services/demo.js';
import { VerifySignInCommand, type SignInResultDto } from './verify-signin.command.js';

/** Step 2: The wallet signed the challenge. The challenge is consumed on the FIRST attempt (pass or fail) and atomically – single use, even under concurrency. */
@CommandHandler(VerifySignInCommand)
export class VerifySignInHandler implements ICommandHandler<VerifySignInCommand, SignInResultDto> {
  private readonly logger = new Logger('SignIn');

  constructor(
    private readonly challenges: ChallengeRepositoryPort,
    private readonly verifier: SignatureVerifierPort,
    private readonly tokens: TokenSignerPort,
    private readonly sessions: PlayerSessionService,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly signIns: SignInRepositoryPort,
    private readonly analytics: AnalyticsPort,
    private readonly profile: MeProfileService,
  ) {}

  async execute(command: VerifySignInCommand): Promise<SignInResultDto> {
    const wallet = parseWalletAddress(command.wallet);
    const now = this.clock.now();

    // 1. Single-use challenge resolution & atomic consumption
    const nonce = command.nonce ?? extractNonce(command.message);
    let challenge: AuthChallenge | null = null;
    if (nonce) {
      challenge = await this.challenges.consume(AuthChallenge.nonceKey(nonce));
    }
    if (!challenge) {
      challenge = await this.challenges.consume(wallet);
    }
    if (!challenge || challenge.isExpired(now)) {
      throw new UnauthorizedError('no valid challenge – request a new nonce');
    }

    // 2. Message property and signature verification
    const rules = this.rules.get();
    if (command.message) {
      const parsed = parseSignInMessage(command.message);
      if (!parsed) {
        throw new UnauthorizedError('bad signature');
      }

      // Domain binding: must match appDomain or gameDomain
      const allowedDomains = [rules.appDomain, rules.gameDomain].filter((d): d is string => d !== null);
      if (!allowedDomains.includes(parsed.domain)) {
        throw new UnauthorizedError('domain mismatch');
      }

      // Address binding: message address must match the signer's wallet
      if (parsed.address !== wallet) {
        throw new UnauthorizedError('address mismatch');
      }

      // Nonce binding: message nonce must match the consumed challenge
      const expectedNonce = challenge.wallet.startsWith('nonce:')
        ? challenge.wallet.slice(6)
        : (challenge.nonce ?? extractNonce(challenge.message));
      if (expectedNonce && parsed.nonce !== expectedNonce) {
        throw new UnauthorizedError('nonce mismatch');
      }

      // Expiration check from message
      if (parsed.expirationTime) {
        const expiresAt = new Date(parsed.expirationTime);
        if (isNaN(expiresAt.getTime()) || expiresAt.getTime() < now.getTime()) {
          throw new UnauthorizedError('challenge expired');
        }
      }

      // Every field the stored challenge set must come back unchanged (what @solana/wallet-standard-util verifySignIn checks): the server's text, not the client's copy
      const issued = challenge.parse();
      if (issued) {
        for (const key of ['domain', 'statement', 'uri', 'version', 'chainId', 'issuedAt', 'expirationTime'] as const) {
          if (issued[key] !== undefined && parsed[key] !== issued[key]) {
            this.logger.warn({ event: 'signin_field_mismatch', msg: `sign-in of ${wallet}: the wallet changed ${key}`, wallet, field: key });   // which wallets rewrite the SIWS text
            throw new UnauthorizedError(`${key} mismatch`);
          }
        }
      }

      // Cryptographic ed25519 verification over the signed SIWS message
      if (!this.verifier.verify(command.message, command.signature, wallet)) {
        throw new UnauthorizedError('bad signature');
      }
    } else {
      // Legacy flow: cryptographic ed25519 verification over the stored challenge message
      if (!this.verifier.verify(challenge.message, command.signature, wallet)) {
        throw new UnauthorizedError('bad signature');
      }
    }

    // 3. Player registration / daily credit grant & JWT session token issuance
    const session = await this.tokens.sign(wallet);
    const player = await this.sessions.touch(wallet, now);

    this.logger.log({ event: 'signin', msg: `signed in ${wallet}`, wallet, ip: command.client.ip });
    await this.signIns.insert({ wallet, at: now, ...command.client }).catch((error: unknown) => {
      this.logger.warn(`sign-in of ${wallet} not recorded: ${error instanceof Error ? error.message : String(error)}`);
    });

    emitAnalytics(this.analytics, () => playerSignedIn({
      wallet, now, isNewPlayer: player.isNewPlayer, isDemo: isDemoWallet(rules, wallet), freeRides: player.freeRides, freeRidesMax: player.freeRidesMax, demoScale: demoScaleOf(rules), createdAt: player.createdAt,
    }));

    return { profile: await this.profile.of(player, now), session };
  }
}
