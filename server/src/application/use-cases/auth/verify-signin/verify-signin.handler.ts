import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toMeDto } from '../../../../domain/players/player.dto.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { UnauthorizedError } from '../../../../domain/shared/errors.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { SignInRepositoryPort } from '../../../ports/auth/sign-in.repository.port.js';
import { SignatureVerifierPort } from '../../../ports/auth/signature-verifier.port.js';
import { TokenSignerPort } from '../../../ports/auth/token-signer.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { PoolTicketsService } from '../../../services/pool-tickets.service.js';
import { demoScaleOf, isDemoWallet } from '../../../services/demo.js';
import { VerifySignInCommand, type SignInResultDto } from './verify-signin.command.js';

/** Step 2: the wallet signed the stored challenge. The challenge is consumed on the FIRST attempt (pass or fail) and atomically – single use, even under concurrency. */
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
    private readonly tickets: PoolTicketsService,
  ) {}

  async execute(command: VerifySignInCommand): Promise<SignInResultDto> {
    const wallet = parseWalletAddress(command.wallet);
    const challenge = await this.challenges.consume(wallet);
    if (!challenge || challenge.isExpired(this.clock.now())) throw new UnauthorizedError('no valid challenge – request a new nonce');
    if (!this.verifier.verify(challenge.message, command.signature, wallet)) throw new UnauthorizedError('bad signature');
    const session = await this.tokens.sign(wallet);
    const now = this.clock.now();
    const player = await this.sessions.touch(wallet, now);
    const rules = this.rules.get();
    this.logger.log({ event: 'signin', msg: `signed in ${wallet}`, wallet, ip: command.client.ip });
    await this.signIns.insert({ wallet, at: now, ...command.client }).catch((error: unknown) => {   // the log of sign-ins must never block one
      this.logger.warn(`sign-in of ${wallet} not recorded: ${error instanceof Error ? error.message : String(error)}`);
    });
    return { profile: toMeDto(player, now, isDemoWallet(rules, wallet), demoScaleOf(rules), await this.tickets.balances(wallet)), session };
  }
}
