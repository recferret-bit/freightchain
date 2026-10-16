import type { PaidTierId } from '../../../src/domain/rides/ride-tier.js';
import { WeeklyTicketRepositoryPort, type WeeklyTicketRecord } from '../../../src/application/ports/prize/weekly-ticket.repository.port.js';
import type { MemoryDb } from './memory-db.js';

export class MemoryWeeklyTicketRepository extends WeeklyTicketRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async ensure(row: { wallet: string; weekId: string; tier: PaidTierId; expiresAt: Date; now: Date }): Promise<void> {
    const key = `${row.wallet}|${row.weekId}`;
    if (this.db.weeklyTickets.has(key)) return;
    this.db.weeklyTickets.set(key, { wallet: row.wallet, weekId: row.weekId, tier: row.tier, expiresAt: row.expiresAt, rideId: null, createdAt: row.now });
  }

  async current(wallet: string, now: Date): Promise<WeeklyTicketRecord | null> {
    const rows = [...this.db.weeklyTickets.values()].filter((r) => r.wallet === wallet && r.rideId === null && r.expiresAt.getTime() > now.getTime());
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ?? null;
  }

  async claim(wallet: string, tier: PaidTierId, rideId: string, now: Date): Promise<boolean> {
    const row = await this.current(wallet, now);
    if (!row || row.tier !== tier) return false;
    this.db.weeklyTickets.set(`${wallet}|${row.weekId}`, { ...row, rideId });
    return true;
  }
}
