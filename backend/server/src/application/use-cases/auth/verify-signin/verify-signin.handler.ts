import { TrustEvidenceService } from '../../../services/trust-evidence.service.js';
import { Logger, Optional } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AuthChallenge, extractNonce, parseSignInMessage } from '../../../../domain/auth/auth-challenge.entity.js';
import { isLocalSignInDomain } from '../../../../domain/auth/sign-in-host.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { IpPrefixHasherPort } from '../../../ports/auth/ip-prefix-hasher.port.js';
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
    private readonly ipHasher: IpPrefixHasherPort,
    @Optional() private readonly evidence?: TrustEvidenceService,
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

      // Domain binding: the app, the game host, or (outside production) the local page the challenge named.
      const allowedDomains = [rules.appDomain, rules.gameDomain].filter((d): d is string => d !== null);
      if (!allowedDomains.includes(parsed.domain) && !(rules.localSignIn && isLocalSignInDomain(parsed.domain))) {
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

      // The signed text must BE the issued challenge, byte for byte (line endings aside) – audit M2: a preamble, a duplicated field or one the challenge never
      // set (Not Before, Request ID, Resources) used to pass because only seven parsed fields were compared. The wallet builds the text from our fields with the
      // standard formatter (formatSignInMessage mirrors it); a wallet that rewrites it is refused here and the client falls back to signing the plain challenge.
      const expected = challenge.messageFor(wallet);
      if (command.message.replace(/\r\n/g, '\n') !== expected) {
        const issued = parseSignInMessage(expected);
        const fields = issued ? (Object.keys(issued) as (keyof typeof issued)[]).filter((k) => parsed[k] !== issued[k]) : [];
        this.logger.warn({ event: 'signin_text_mismatch', msg: `sign-in of ${wallet}: the signed text is not the issued challenge${fields.length ? ` (${fields.join(', ')})` : ' (extra lines)'}`, wallet, fields });   // which wallets rewrite the SIWS text
        throw new UnauthorizedError('the signed text is not the issued challenge');
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

    const ipHash = this.ipHasher.hash(command.client.ip);
    this.logger.log({ event: 'signin', msg: `signed in ${wallet}`, wallet });
    await this.signIns.insert({ wallet, at: now, ipHash, ...(this.evidence ? { network: await this.evidence.networkOf(ipHash, command.client.ip) } : {}) }).catch(() => {
      this.logger.warn(`sign-in of ${wallet} not recorded`);
    });

    emitAnalytics(this.analytics, () => playerSignedIn({
      wallet, now, isNewPlayer: player.isNewPlayer, isDemo: isDemoWallet(rules, wallet), freeRides: player.freeRides, freeRidesMax: player.freeRidesMax, demoScale: demoScaleOf(rules), createdAt: player.createdAt,
    }));

    return { profile: await this.profile.of(player, now), session };
  }
}
