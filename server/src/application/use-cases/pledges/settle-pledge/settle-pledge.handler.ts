import { Injectable } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { SettlePledgeCommand } from './settle-pledge.command.js';
import { toPledgeDto, type PledgeDto } from '../../../../domain/economy/pledge.dto.js';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { VerdictStatus } from '../../../../domain/verdict/verdict.dto.js';
import { PledgeRepositoryPort } from '../../../ports/economy/pledge.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideVerdictRepositoryPort } from '../../../ports/verdict/ride-verdict.repository.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';

@Injectable()
@CommandHandler(SettlePledgeCommand)
export class SettlePledgeHandler implements ICommandHandler<SettlePledgeCommand, PledgeDto> {
  constructor(
    private readonly pledges: PledgeRepositoryPort,
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly verdicts: RideVerdictRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(c: SettlePledgeCommand): Promise<PledgeDto> {
    return this.transactions.run(async (tx) => {
      const pledge = await this.pledges.findById(c.pledgeId, tx);
      if (!pledge) throw new NotFoundError('pledge not found');
      if (pledge.isSettled) throw new ConflictError('pledge already settled');

      await this.players.findByWalletForUpdate(pledge.props.driver, tx);

      const ride = await this.rides.findById(pledge.rideId, tx);
      if (!ride) throw new NotFoundError('ride not found');

      const verdict = await this.verdicts.findByRide(pledge.rideId, tx);
      const isFlagged = verdict
        ? verdict.status === VerdictStatus.Flagged || verdict.status === VerdictStatus.Rejected
        : !ride.isInStatus(RideStatus.Completed);

      const dist = ride.distance || ride.completeDist;
      const verifiedKm = Math.floor(dist / 1000);

      pledge.settle(verifiedKm, isFlagged, this.clock.now(), c.signature, c.slot);
      await this.pledges.save(pledge, tx);

      return toPledgeDto(pledge);
    });
  }
}
