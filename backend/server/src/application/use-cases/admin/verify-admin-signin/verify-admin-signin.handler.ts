import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { adminSignInKey } from '../../../../domain/admin/admin-proof.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { NotFoundError, UnauthorizedError } from '../../../../domain/shared/errors.js';
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

  async execute({ wallet: raw, signature, client, requestId }: VerifyAdminSignInCommand): Promise<AdminSignInResultDto> {
    const wallet = parseWalletAddress(raw);
    if (!this.rules.get().adminWallets.has(wallet)) throw new NotFoundError('not found');
    const challenge = await this.challenges.consume(adminSignInKey(wallet));
    const now = this.clock.now();
    if (!challenge || challenge.isExpired(now)) throw new UnauthorizedError('no valid admin challenge – request a new one');
    if (!this.verifier.verify(challenge.message, signature, wallet)) {
      this.logger.warn({ event: 'admin-signin', msg: `admin sign-in of ${wallet} refused: bad signature`, wallet, ip: client.ip, ok: false });
      throw new UnauthorizedError('bad signature');
    }
    const session = await this.tokens.sign(wallet);
    await this.audit.insert({ wallet, action: 'auth.signin', target: wallet, detail: { ip: client.ip, userAgent: client.userAgent, until: session.expiresAt.toISOString() }, requestId, at: now });
    this.logger.log({ event: 'admin-signin', msg: `admin signed in ${wallet}`, wallet, ip: client.ip, ok: true });
    return { admin: { wallet, expiresAt: session.expiresAt.getTime() }, session };
  }
}
