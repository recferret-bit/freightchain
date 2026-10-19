import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { AdjustFreeRidesCommand, type FreeRidesAdjustedDto } from './adjust-free-rides.command.js';

/** Add or remove free rides. The wallet must already exist. A delta that would go below zero or above the hard ceiling is refused, not clamped. */
@CommandHandler(AdjustFreeRidesCommand)
export class AdjustFreeRidesHandler implements ICommandHandler<AdjustFreeRidesCommand, FreeRidesAdjustedDto> {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, wallet, delta, requestId, signature }: AdjustFreeRidesCommand): Promise<FreeRidesAdjustedDto> {
    const proof = await this.proofs.prove(admin, { action: 'free_rides_adjust', wallet, delta }, signature);
    return this.transactions.run(async (tx) => {
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('this wallet has never signed in');
      player.adjustFreeRides(delta);
      const saved = await this.players.save(player, tx);
      await this.audit.insert({
        wallet: admin, action: 'free_rides.adjust', target: wallet,
        detail: { delta, freeRides: saved.freeRides, signed: proof }, requestId, at: this.clock.now(),
      }, tx);
      return { wallet, delta, freeRides: saved.freeRides, freeRidesMax: saved.freeRidesMax };
    });
  }
}
