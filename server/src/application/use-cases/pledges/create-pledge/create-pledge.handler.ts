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
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';

@Injectable()
@CommandHandler(CreatePledgeCommand)
export class CreatePledgeHandler implements ICommandHandler<CreatePledgeCommand, PledgeDto> {
  constructor(
    private readonly pledges: PledgeRepositoryPort,
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly poolChain: PoolChainPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute(c: CreatePledgeCommand): Promise<PledgeDto> {
    return this.transactions.run(async (tx) => {
      const sponsorPlayer = await this.players.findByWalletForUpdate(c.sponsor, tx);
      if (!sponsorPlayer) throw new NotFoundError('sponsor player not found');
      sponsorPlayer.requirePaidPlay();

      const ride = await this.rides.findById(c.rideId, tx);
      if (!ride) throw new NotFoundError('ride not found');

      if (c.sponsor === ride.wallet) {
        throw new BadRequestError('sponsor cannot be the driver');
      }

      if (!ride.isInStatus(RideStatus.Created, RideStatus.Running)) {
        throw new ConflictError('ride is not active');
      }

      if (ride.props.poolId === null || ride.props.poolId === undefined || ride.props.poolId <= 0) {
        throw new ConflictError('pledges are only permitted on pool-backed rides', 'ride_not_in_pool');
      }

      const pool = await this.pools.findById(ride.props.poolId, tx);
      if (!pool || (!pool.isActive && pool.status !== 'open')) {
        throw new ConflictError('pool is not live');
      }

      const existing = await this.pledges.findByRideAndSponsor(c.rideId, c.sponsor, tx);
      if (existing) {
        throw new ConflictError('pledge already exists for this ride and sponsor');
      }

      const pdaAddress = this.poolChain.pledgePda(rideIdToBytes(c.rideId), c.sponsor);
      const id = this.entropy.uuid();
      const pledge = Pledge.create({
        id,
        pdaAddress,
        rideId: c.rideId,
        sponsor: c.sponsor,
        driver: ride.wallet,
        poolId: ride.props.poolId,
        lamportsPerKm: c.lamportsPerKm,
        targetKm: c.targetKm,
        now: this.clock.now(),
      });

      await this.pledges.insert(pledge, tx);
      return toPledgeDto(pledge);
    });
  }
}
