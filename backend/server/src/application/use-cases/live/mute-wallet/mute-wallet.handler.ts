import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { MuteDto } from '../../../../domain/live/live.dto.js';
import { BadRequestError } from '../../../../domain/shared/errors.js';
import { RideMuteRepositoryPort } from '../../../ports/live/ride-mute.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { MuteWalletCommand } from './mute-wallet.command.js';

/** Chat safety: only the ride's owner, under its player row lock (player → the ride read → the mute row). Idempotent; works on an ended ride too (its replay feed). */
@CommandHandler(MuteWalletCommand)
export class MuteWalletHandler implements ICommandHandler<MuteWalletCommand, MuteDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly mutes: RideMuteRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, rideId, target, muted }: MuteWalletCommand): Promise<MuteDto> {
    if (target === wallet) throw new BadRequestError('you cannot mute yourself', 'bad_mute');
    return this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      const ride = await this.lookup.require(rideId, wallet, tx);
      await this.mutes.set(ride.id, target, muted, this.clock.now(), tx);
      return { wallet: target, muted };
    });
  }
}
