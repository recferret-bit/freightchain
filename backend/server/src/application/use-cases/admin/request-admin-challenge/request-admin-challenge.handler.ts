import { Optional } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { adminSignInChallenge, adminSignInKey } from '../../../../domain/admin/admin-proof.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { HasherPort } from '../../../ports/shared/hasher.port.js';
import type { ChallengeDto } from '../../auth/request-challenge/request-challenge.command.js';
import { RequestAdminChallengeCommand } from './request-admin-challenge.command.js';

const NONCE_BYTES = 16;
const MAX_PENDING = 5;

/** Step 1 of the admin sign-in. A wallet that is not an admin or a moderator still gets a message of the same shape; nothing is stored, so verify fails. */
@CommandHandler(RequestAdminChallengeCommand)
export class RequestAdminChallengeHandler implements ICommandHandler<RequestAdminChallengeCommand, ChallengeDto> {
  constructor(
    private readonly challenges: ChallengeRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
    @Optional() private readonly hasher?: HasherPort,
  ) {}

  async execute(command: RequestAdminChallengeCommand): Promise<ChallengeDto> {
    const wallet = parseWalletAddress(command.wallet);
    const clientId = (command.clientId || 'default').slice(0, 80);
    const rules = this.rules.get();
    const allowed = rules.adminWallets.has(wallet) || (rules.moderatorWallets?.has(wallet) ?? false);
    const now = this.clock.now();
    if (!allowed) {
      const nonce = (this.hasher?.sha256Hex(`fc-admin-dummy:${wallet}:${clientId}`) ?? this.entropy.hex(NONCE_BYTES)).slice(0, 32);
      return { message: adminSignInChallenge({ wallet, domain: rules.adminDomain, origin: rules.adminOrigin, nonce, now, ttlMs: rules.nonceTtlMs, clientId }).message };
    }
    const mine = adminSignInKey(wallet, clientId);
    const pending = await this.challenges.listKeys(`admin:${wallet}:`);
    if (!pending.includes(mine) && pending.length >= MAX_PENDING) await this.challenges.consume(pending[0] as string);
    const challenge = adminSignInChallenge({ wallet, domain: rules.adminDomain, origin: rules.adminOrigin, nonce: this.entropy.hex(NONCE_BYTES), now, ttlMs: rules.nonceTtlMs, clientId });
    await this.challenges.upsert(challenge);
    return { message: challenge.message };
  }
}
