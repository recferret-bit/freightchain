import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminRideDetailDto } from '../../../../domain/admin/admin.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { AdminQueryPort } from '../../../ports/admin/admin-query.port.js';
import { PaymentRepositoryPort } from '../../../ports/economy/payment.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { RideVerdictRepositoryPort } from '../../../ports/verdict/ride-verdict.repository.port.js';
import { adminRowOf, toAdminRideRow } from '../admin-ride-row.js';
import { GetAdminRideQuery } from './get-admin-ride.query.js';

/** One ride for review: the row, its verdict with every reason and score (and an admin decision, if any), the recording's batch index, the payment. Any rider's ride. */
@QueryHandler(GetAdminRideQuery)
export class GetAdminRideHandler implements IQueryHandler<GetAdminRideQuery, AdminRideDetailDto> {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly verdicts: RideVerdictRepositoryPort,
    private readonly admin: AdminQueryPort,
    private readonly payments: PaymentRepositoryPort,
  ) {}

  async execute({ rideId }: GetAdminRideQuery): Promise<AdminRideDetailDto> {
    const ride = await this.rides.findById(rideId);
    if (!ride) throw new NotFoundError('ride not found');
    const [verdict, batches, payment] = await Promise.all([this.verdicts.findByRide(rideId), this.admin.batchIndex(rideId), this.payments.findByRide(rideId)]);
    const p = ride.snapshot(), v = verdict?.snapshot();
    return {
      ride: {
        ...toAdminRideRow(adminRowOf(ride, verdict?.status ?? null, verdict?.isOverridden ?? false)),
        seed: p.seed, minSeconds: p.minSeconds, completeDist: p.completeDist, hull: p.hull, lastHbAt: p.lastHbAt?.getTime() ?? null, lamports: p.lamports, roundId: p.roundId,
      },
      verdict: verdict && v ? { ...verdict.toDto(), scores: v.scores, rulesVersion: v.rulesVersion } : null,
      batches,
      payment: payment ? { signature: payment.signature, lamports: payment.lamports, at: payment.at.getTime() } : null,
    };
  }
}
