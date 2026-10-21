import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { appealError, appealRefusal, openAppeal, resolveAppeal, type RideAppealRecord } from '../../../../domain/rides/ride-appeal.js';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { RideAppealRepositoryPort } from '../../../ports/rides/ride-appeal.repository.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { RideVerdictRepositoryPort } from '../../../ports/verdict/ride-verdict.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { SubmitRideAppealCommand, ResolveRideAppealCommand, ListRideAppealsQuery, type RideAppealDto } from './ride-appeal.command.js';

export const toAppealDto = (row: RideAppealRecord): RideAppealDto => ({
  id: row.id, rideId: row.rideId, poolId: row.poolId, wallet: row.wallet, status: row.status, reason: row.reason,
  createdAt: row.createdAt.getTime(), resolvedAt: row.resolvedAt?.getTime() ?? null,
});

@CommandHandler(SubmitRideAppealCommand)
export class SubmitRideAppealHandler implements ICommandHandler<SubmitRideAppealCommand, RideAppealDto> {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly verdicts: RideVerdictRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly appeals: RideAppealRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute({ wallet, rideId, reason }: SubmitRideAppealCommand): Promise<RideAppealDto> {
    return this.transactions.run(async (tx) => {
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('ride not found');
      const ride = await this.rides.findById(rideId, tx);
      if (!ride || ride.wallet !== wallet) throw new NotFoundError('ride not found');
      const pool = ride.poolId === null ? null : await this.pools.findById(ride.poolId, tx);
      const verdict = await this.verdicts.findByRide(rideId, tx);
      const now = this.clock.now();
      const code = appealRefusal({
        own: true, poolId: ride.poolId, rideStatus: ride.status, verdict: verdict?.status ?? null, now, reason,
        playCloseAt: pool?.playCloseAt ?? new Date(0), validationUntil: pool?.validationUntil ?? new Date(0),
      });
      if (code) throw appealError(code);
      if (await this.appeals.findByRide(rideId, tx)) throw new ConflictError('this ride already has an appeal', 'appeal_exists');
      const row = openAppeal({ id: this.entropy.uuid(), rideId, wallet, poolId: pool!.id, reason, now });
      await this.appeals.insert(row, tx);
      return toAppealDto(row);
    });
  }
}

@QueryHandler(ListRideAppealsQuery)
export class ListRideAppealsHandler implements IQueryHandler<ListRideAppealsQuery, { appeals: RideAppealDto[] }> {
  constructor(private readonly appeals: RideAppealRepositoryPort) {}

  async execute({ poolId }: ListRideAppealsQuery): Promise<{ appeals: RideAppealDto[] }> {
    return { appeals: (await this.appeals.listOpen(poolId)).map(toAppealDto) };
  }
}

@CommandHandler(ResolveRideAppealCommand)
export class ResolveRideAppealHandler implements ICommandHandler<ResolveRideAppealCommand, RideAppealDto> {
  constructor(
    private readonly appeals: RideAppealRepositoryPort,
    private readonly proofs: AdminProofService,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, appealId, decision, note, signature }: ResolveRideAppealCommand): Promise<RideAppealDto> {
    const proof = await this.proofs.prove(admin, { action: 'appeal_resolve', appealId, decision, note }, signature);
    const row = await this.appeals.findById(appealId);
    if (!row) throw new NotFoundError('appeal not found');
    const next = resolveAppeal(row, decision, admin, note, this.clock.now());
    await this.appeals.save(next);
    void proof;
    return toAppealDto(next);
  }
}
