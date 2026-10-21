import { Injectable } from '@nestjs/common';
import { RideAppealRepositoryPort } from '../../../src/application/ports/rides/ride-appeal.repository.port.js';
import type { RideAppealRecord } from '../../../src/domain/rides/ride-appeal.js';
import { RideStatus } from '../../../src/domain/rides/ride-status.js';
import type { MemoryDb } from './memory-db.js';

/** In-memory appeals. `blockers` counts open appeals and rides still running, the same rule as the Prisma adapter. */
@Injectable()
export class MemoryRideAppealRepository extends RideAppealRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async findByRide(rideId: string): Promise<RideAppealRecord | null> {
    return this.db.appeals.find((row) => row.rideId === rideId) ?? null;
  }

  async findById(id: string): Promise<RideAppealRecord | null> {
    return this.db.appeals.find((row) => row.id === id) ?? null;
  }

  async insert(row: RideAppealRecord): Promise<void> { this.db.appeals.push(row); }

  async save(row: RideAppealRecord): Promise<void> {
    this.db.appeals = this.db.appeals.map((stored) => stored.id === row.id ? row : stored);
  }

  async listOpen(poolId?: number): Promise<RideAppealRecord[]> {
    return this.db.appeals.filter((row) => row.status === 'open' && (poolId === undefined || row.poolId === poolId));
  }

  async blockers(poolId: number): Promise<{ openAppeals: number; running: number }> {
    const openAppeals = this.db.appeals.filter((row) => row.poolId === poolId && row.status === 'open').length;
    const running = [...this.db.rides.values()].filter(({ props }) => props.poolId === poolId && props.status === RideStatus.Running).length;
    return { openAppeals, running };
  }
}
