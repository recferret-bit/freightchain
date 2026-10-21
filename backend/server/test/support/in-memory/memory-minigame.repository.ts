import { RideMiniGameRepositoryPort } from '../../../src/application/ports/minigames/ride-minigame.repository.port.js';
import type { RideMiniGame } from '../../../src/domain/minigames/ride-minigame.js';

/** Process-local rows for the HTTP harness. The Prisma repository is the one the app uses outside tests. */
export class MemoryRideMiniGameRepository extends RideMiniGameRepositoryPort {
  private readonly rows = new Map<string, RideMiniGame>();

  listByRide(rideId: string): Promise<RideMiniGame[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.rideId === rideId).sort((a, b) => a.ordinal - b.ordinal));
  }

  findById(id: string): Promise<RideMiniGame | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  insert(row: RideMiniGame): Promise<RideMiniGame> {
    const existing = [...this.rows.values()].find((item) => item.rideId === row.rideId && item.ordinal === row.ordinal);
    if (existing) return Promise.resolve(existing);
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  save(row: RideMiniGame): Promise<void> {
    this.rows.set(row.id, row);
    return Promise.resolve();
  }
}
