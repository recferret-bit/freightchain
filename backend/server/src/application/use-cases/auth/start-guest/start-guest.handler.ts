import { Logger } from '@nestjs/common';
import { IpPrefixHasherPort } from '../../../ports/auth/ip-prefix-hasher.port.js';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SignInRepositoryPort } from '../../../ports/auth/sign-in.repository.port.js';
import { TokenSignerPort } from '../../../ports/auth/token-signer.port.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { playerSignedIn } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { demoScaleOf, isDemoWallet } from '../../../services/demo.js';
import { MeProfileService } from '../../../services/me-profile.service.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import type { SignInResultDto } from '../verify-signin/verify-signin.command.js';
import { StartGuestCommand } from './start-guest.command.js';

/**
 * Anonymous EASY. A random 32-byte base58 address is the wallet; no secret key exists, so the session cannot sign a transaction.
 * Achievements and stats stay on this wallet and do not merge into a later sign-in. Guests cannot order a paid tier, MEDIUM, HARD, a promo, or a ranked start.
 */
@CommandHandler(StartGuestCommand)
export class StartGuestHandler implements ICommandHandler<StartGuestCommand, SignInResultDto> {
  private readonly logger = new Logger('Guest');

  constructor(
    private readonly tokens: TokenSignerPort,
    private readonly sessions: PlayerSessionService,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly signIns: SignInRepositoryPort,
    private readonly analytics: AnalyticsPort,
    private readonly profile: MeProfileService,
    private readonly entropy: EntropyPort,
    private readonly ipHasher: IpPrefixHasherPort,
  ) {}

  async execute(command: StartGuestCommand): Promise<SignInResultDto> {
    const wallet = this.entropy.referenceKey();
    const now = this.clock.now();
    const rules = this.rules.get();
    const session = await this.tokens.sign(wallet);
    const player = await this.sessions.touch(wallet, now, { guest: true });
    this.logger.log({ event: 'guest', msg: `guest session ${wallet}`, wallet });
    await this.signIns.insert({ wallet, at: now, ipHash: this.ipHasher.hash(command.client.ip) }).catch(() => {
      this.logger.warn(`guest ${wallet} not recorded`);
    });
    emitAnalytics(this.analytics, () => playerSignedIn({
      wallet, now, isNewPlayer: player.isNewPlayer, isDemo: isDemoWallet(rules, wallet), freeRides: player.freeRides, freeRidesMax: player.freeRidesMax, demoScale: demoScaleOf(rules), createdAt: player.createdAt,
    }));
    return { profile: await this.profile.of(player, now), session };
  }
}
