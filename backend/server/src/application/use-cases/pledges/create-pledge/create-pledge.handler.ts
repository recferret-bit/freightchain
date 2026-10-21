import { Injectable } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { CreatePledgeCommand } from './create-pledge.command.js';
import { Pledge } from '../../../../domain/economy/pledge.entity.js';
import { toPledgeDto, type PledgeDto } from '../../../../domain/economy/pledge.dto.js';
import { rideIdToBytes } from '../../../../domain/economy/pledge.types.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { PledgeRepositoryPort } from '../../../ports/economy/pledge.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { PoolChainPort, type BuiltTransaction } from '../../../ports/economy/pool-chain.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { PledgeService } from '../../../live/pledge.service.js';

export interface CreatedPledgeDto {
  pledge: PledgeDto;
  /** the unsigned create_pledge: the sponsor's wallet signs AND sends it, then POST /api/pledges/:id/confirm */
  transaction: BuiltTransaction;
}

/**
 * A spectator pledges lamports per km to a ticket ride on the road: the row is 'pending' and the server answers the create_pledge transaction to sign – nothing
 * is owed until the chain shows the PledgeCreated (confirm, or the pledge job finds it). Asking again for a pending / never-signed pledge rebuilds it with the new terms.
 */
@Injectable()
@CommandHandler(CreatePledgeCommand)
export class CreatePledgeHandler implements ICommandHandler<CreatePledgeCommand, CreatedPledgeDto> {
  constructor(
    private readonly pledges: PledgeRepositoryPort,
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly poolChain: PoolChainPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
    private readonly pledgeGate: PledgeService,
  ) {}

  async execute(c: CreatePledgeCommand): Promise<CreatedPledgeDto> {
    this.pledgeGate.assertEnabled();
    const pledge = await this.transactions.run(async (tx) => {
      const sponsorPlayer = await this.players.findByWalletForUpdate(c.sponsor, tx);
      if (!sponsorPlayer) throw new NotFoundError('sponsor player not found');
      sponsorPlayer.requirePaidPlay();

      const ride = await this.rides.findById(c.rideId, tx);
      if (!ride) throw new NotFoundError('ride not found');
      if (c.sponsor === ride.wallet) throw new BadRequestError('sponsor cannot be the driver');
      if (!ride.isInStatus(RideStatus.Created, RideStatus.Running)) throw new ConflictError('the ride is not on the road', 'ride_not_active');
      const poolId = ride.props.poolId;
      if (poolId === null || poolId === undefined) throw new ConflictError('pledges are only for ticket rides of a pool', 'ride_not_in_pool');
      const maxKm = Math.ceil(ride.completeDist / 1000);
      if (c.targetKm > maxKm) throw new BadRequestError(`the shift ends at ${maxKm} km – pledge for at most that`, 'target_beyond_finish');

      const pool = await this.pools.findById(poolId, tx);
      const now = this.clock.now();
      if (!pool || (!pool.isActive && pool.status !== 'open') || now.getTime() >= pool.playDeadline.getTime()) throw new ConflictError('the pool no longer takes pledges', 'pool_not_live');

      const pdaAddress = this.poolChain.pledgePda(rideIdToBytes(c.rideId), c.sponsor);
      const existing = await this.pledges.findByRideAndSponsor(c.rideId, c.sponsor, tx);
      if (existing && existing.status !== 'pending' && existing.status !== 'abandoned') throw new ConflictError('you already pledged to this ride', 'pledge_exists');
      const fresh = Pledge.create({
        id: existing?.id ?? this.entropy.uuid(), pdaAddress, rideId: c.rideId, sponsor: c.sponsor, driver: ride.wallet, poolId,
        lamportsPerKm: c.lamportsPerKm, targetKm: c.targetKm, now,
      });
      if (existing) await this.pledges.save(fresh, tx); else await this.pledges.insert(fresh, tx);
      return fresh;
    });
    const transaction = await this.poolChain.buildCreatePledgeTransaction({
      sponsor: pledge.sponsor, poolId: pledge.poolId, rideId: pledge.rideId, driver: pledge.driver, lamportsPerKm: pledge.lamportsPerKm, targetKm: pledge.targetKm,
    });
    return { pledge: toPledgeDto(pledge), transaction };
  }
}
