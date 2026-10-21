import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminRideDetailDto } from '../../../../domain/admin/admin.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { AdminQueryPort } from '../../../ports/admin/admin-query.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { PaymentRepositoryPort } from '../../../ports/economy/payment.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { RideReplayRepositoryPort } from '../../../ports/verdict/ride-replay.repository.port.js';
import { RideVerdictRepositoryPort } from '../../../ports/verdict/ride-verdict.repository.port.js';
import { adminRowOf, toAdminRideRow } from '../admin-ride-row.js';
import { GetAdminRideQuery } from './get-admin-ride.query.js';

/** One ride for review: the row, its verdict with every reason and score (and an admin decision, if any), its replay verification sessions, the recording's batch index, the payment. Any rider's ride. */
@QueryHandler(GetAdminRideQuery)
export class GetAdminRideHandler implements IQueryHandler<GetAdminRideQuery, AdminRideDetailDto> {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly verdicts: RideVerdictRepositoryPort,
    private readonly admin: AdminQueryPort,
    private readonly payments: PaymentRepositoryPort,
    @Optional() private readonly replays?: RideReplayRepositoryPort,
    @Optional() private readonly audit?: AdminActionRepositoryPort,
    @Optional() private readonly clock?: ClockPort,
  ) {}

  async execute({ rideId, actor }: GetAdminRideQuery): Promise<AdminRideDetailDto> {
    const ride = await this.rides.findById(rideId);
    if (!ride) throw new NotFoundError('ride not found');
    const [verdict, batches, payment, replayRows] = await Promise.all([
      this.verdicts.findByRide(rideId),
      this.admin.batchIndex(rideId),
      this.payments.findByRide(rideId),
      this.replays ? this.replays.listByRide(rideId) : Promise.resolve([]),
    ]);
    if (actor && this.audit && this.clock) {
      await this.audit.insert({
        wallet: actor, action: 'read.telemetry', target: rideId, role: 'admin', requestId: null, at: this.clock.now(),
        beforeState: null, afterState: { batches: batches.length }, detail: { samples: batches.reduce((n, b) => n + b.samples, 0) },
      });
    }
    const p = ride.snapshot(), v = verdict?.snapshot();
    return {
      ride: {
        ...toAdminRideRow(adminRowOf(ride, verdict?.status ?? null, verdict?.isOverridden ?? false)),
        seed: p.seed, minSeconds: p.minSeconds, completeDist: p.completeDist, hull: p.hull, lastHbAt: p.lastHbAt?.getTime() ?? null, lamports: p.lamports, roundId: p.roundId,
      },
      verdict: verdict && v ? { ...verdict.toDto(), scores: v.scores, rulesVersion: v.rulesVersion } : null,
      replays: replayRows.map((r) => r.toDto()),
      batches,
      payment: payment ? { signature: payment.signature, lamports: payment.lamports, at: payment.at.getTime() } : null,
    };
  }
}
