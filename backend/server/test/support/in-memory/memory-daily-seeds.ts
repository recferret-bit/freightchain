import { DailySeedRepositoryPort } from '../../../src/application/ports/rides/daily-seed.repository.port.js';
import type { PaidTierId } from '../../../src/domain/rides/ride-tier.js';
import type { MemoryDb } from './memory-db.js';

export class MemoryDailySeedRepository extends DailySeedRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async claim(tier: PaidTierId, day: string, candidate: number): Promise<number> {
    const key = `${tier}|${day}`;
    if (!this.db.dailySeeds.has(key)) this.db.dailySeeds.set(key, candidate);
    return this.db.dailySeeds.get(key) as number;
  }
}
