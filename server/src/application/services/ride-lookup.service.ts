import { Injectable } from '@nestjs/common';
import type { Ride } from '../../domain/rides/ride.entity.js';
import { NotFoundError } from '../../domain/shared/errors.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';

/** A ride is private to its owner: someone else's id is indistinguishable from a missing one. */
@Injectable()
export class RideLookupService {
  constructor(private readonly rides: RideRepositoryPort) {}

  async require(id: string, wallet: string, tx?: TransactionHandle): Promise<Ride> {
    const ride = await this.rides.findById(id, tx);
    if (!ride || ride.wallet !== wallet) throw new NotFoundError('ride not found');
    return ride;
  }
}
