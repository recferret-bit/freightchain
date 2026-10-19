import type { PaidTierId } from '../../../src/domain/rides/ride-tier.js';
import { WeeklyTicketRepositoryPort, type WeeklyTicketRecord } from '../../../src/application/ports/prize/weekly-ticket.repository.port.js';
import type { MemoryDb } from './memory-db.js';

const keyOf = (wallet: string, tier: string, periodStart: Date) => `${wallet}|${tier}|${periodStart.toISOString()}`;
const TIER_ORDER: Record<string, number> = { '1h': 0, '4h': 1, '8h': 2 };

export class MemoryWeeklyTicketRepository extends WeeklyTicketRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async ensure(row: { wallet: string; weekId: string; tier: PaidTierId; periodStart: Date; expiresAt: Date; now: Date }): Promise<void> {
    const key = keyOf(row.wallet, row.tier, row.periodStart);
    if (this.db.weeklyTickets.has(key)) return;
    this.db.weeklyTickets.set(key, { wallet: row.wallet, weekId: row.weekId, tier: row.tier, periodStart: row.periodStart, expiresAt: row.expiresAt, rideId: null, createdAt: row.now });
  }

  async live(wallet: string, now: Date): Promise<WeeklyTicketRecord[]> {
    return [...this.db.weeklyTickets.values()]
      .filter((r) => r.wallet === wallet && r.rideId === null && r.expiresAt.getTime() > now.getTime())
      .sort((a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || a.periodStart.getTime() - b.periodStart.getTime());
  }

  async hasPeriod(wallet: string, tier: PaidTierId, periodStart: Date): Promise<boolean> {
    return this.db.weeklyTickets.has(keyOf(wallet, tier, periodStart));
  }

  async claim(wallet: string, tier: PaidTierId, rideId: string, now: Date): Promise<boolean> {
    const row = (await this.live(wallet, now)).find((r) => r.tier === tier);
    if (!row) return false;
    this.db.weeklyTickets.set(keyOf(wallet, tier, row.periodStart), { ...row, rideId });
    return true;
  }
}
