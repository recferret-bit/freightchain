import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { adminSignInKey } from '../../../../domain/admin/admin-proof.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { maskIpSubnet } from '../../../../domain/shared/ip-mask.js';
import { UnauthorizedError } from '../../../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { AdminTokenPort } from '../../../ports/admin/admin-token.port.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { SignatureVerifierPort } from '../../../ports/auth/signature-verifier.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { VerifyAdminSignInCommand, type AdminSignInResultDto } from './verify-admin-signin.command.js';

/**
 * Step 2: the admin's wallet signed the admin sign-in message → a short admin session (AdminTokenPort, the fc_admin cookie). The challenge is consumed on
 * the first attempt, pass or fail. The allowlist is checked again here (a wallet removed between the two steps gets nothing). Audited as auth.signin.
 */
@CommandHandler(VerifyAdminSignInCommand)
export class VerifyAdminSignInHandler implements ICommandHandler<VerifyAdminSignInCommand, AdminSignInResultDto> {
  private readonly logger = new Logger('AdminSignIn');

  constructor(
    private readonly challenges: ChallengeRepositoryPort,
    private readonly verifier: SignatureVerifierPort,
    private readonly tokens: AdminTokenPort,
    private readonly audit: AdminActionRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet: raw, signature, client, requestId, clientId }: VerifyAdminSignInCommand): Promise<AdminSignInResultDto> {
    const wallet = parseWalletAddress(raw);
    const rules = this.rules.get();
    const allowed = rules.adminWallets.has(wallet) || (rules.moderatorWallets?.has(wallet) ?? false);
    const challenge = await this.challenges.consume(adminSignInKey(wallet, clientId || 'default'));
    const now = this.clock.now();
    const ipSubnet = maskIpSubnet(client.ip);
    if (!allowed) {
      await this.fail(wallet, requestId, now, ipSubnet, client.userAgent, 'invalid_credentials');
      throw new UnauthorizedError('invalid credentials', 'invalid_credentials');
    }
    if (!challenge || challenge.isExpired(now)) {
      await this.fail(wallet, requestId, now, ipSubnet, client.userAgent, 'no_challenge');
      throw new UnauthorizedError('no valid admin challenge – request a new one');
    }
    if (!this.verifier.verify(challenge.message, signature, wallet)) {
      this.logger.warn({ event: 'admin-signin', msg: `admin sign-in of ${wallet} refused: bad signature`, wallet, ip: ipSubnet, ok: false });
      await this.fail(wallet, requestId, now, ipSubnet, client.userAgent, 'bad_signature');
      throw new UnauthorizedError('bad signature');
    }
    const session = await this.tokens.sign(wallet);
    await this.audit.insert({
      wallet, action: 'auth.signin', target: wallet, role: rules.adminWallets.has(wallet) ? 'admin' : 'moderator',
      detail: { ip: ipSubnet, userAgent: client.userAgent, until: session.expiresAt.toISOString() }, ipSubnet, requestId, at: now,
    });
    this.logger.log({ event: 'admin-signin', msg: `admin signed in ${wallet}`, wallet, ip: ipSubnet, ok: true });
    return { admin: { wallet, expiresAt: session.expiresAt.getTime() }, session };
  }

  private async fail(wallet: string, requestId: string | null, at: Date, ipSubnet: string | null, userAgent: string | null, reason: string) {
    await this.audit.insert({ wallet, action: 'auth.fail', target: wallet, role: 'admin', detail: { ip: ipSubnet, userAgent, reason }, ipSubnet, requestId, at });
  }
}
