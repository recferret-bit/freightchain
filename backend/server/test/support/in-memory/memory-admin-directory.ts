import { Injectable } from '@nestjs/common';
import { AdminDirectoryPort } from '../../../src/application/ports/admin/admin-directory.port.js';
import type { AdminPlayerRowDto, AdminPoolDetailDto, AdminPoolRowDto, AdminSessionsDto } from '../../../src/domain/admin/admin.dto.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';
import type { StatsTotals } from '../../../src/domain/stats/stats.js';
import { MemoryDb } from './memory-db.js';

@Injectable()
export class MemoryAdminDirectory extends AdminDirectoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async players(q: string | undefined, limit: number): Promise<AdminPlayerRowDto[]> {
    return [...this.db.players.values()].filter((p) => !q || p.wallet.startsWith(q))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.wallet < b.wallet ? -1 : 1)).slice(0, limit)
      .map((p) => {
        const last = this.db.signIns.filter((s) => s.wallet === p.wallet).reduce<number | null>((m, s) => (m === null || s.at.getTime() > m ? s.at.getTime() : m), null);
        const tickets = [...this.db.tickets.values()].filter((t) => t.wallet === p.wallet).reduce((sum, t) => sum + t.balance, 0);
        return { wallet: p.wallet, freeRides: p.freeRides, freeRidesMax: p.freeRidesMax, createdAt: p.createdAt.getTime(), lastSignInAt: last, rides: this.db.playerStats.get(p.wallet)?.totals.rides ?? 0, tickets };
      });
  }

  private poolRow(p: PoolProps): AdminPoolRowDto {
    return {
      id: p.id, address: p.address, tier: p.tier, label: p.label, status: p.status, priceLamports: p.priceLamports, minTickets: p.minTickets, maxTickets: p.maxTickets, maxPerWallet: p.maxPerWallet,
      ticketsSold: p.ticketsSold, buyers: p.buyers, vaultLamports: p.vaultLamports, sponsored: p.sponsored, roundId: p.roundId, rideSeed: p.rideSeed,
      prepDeadline: p.prepDeadline.getTime(), playDeadline: p.playDeadline.getTime(), createdAt: p.createdAt.getTime(), syncedAt: p.syncedAt?.getTime() ?? null,
    };
  }

  async pools(limit: number): Promise<AdminPoolRowDto[]> {
    return [...this.db.pools.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id).slice(0, limit).map((p) => this.poolRow(p));
  }

  async pool(id: number): Promise<AdminPoolDetailDto | null> {
    const p = this.db.pools.get(id);
    if (!p) return null;
    const holders = [...this.db.tickets.values()].filter((t) => t.poolId === id).sort((a, b) => b.bought - a.bought || (a.wallet < b.wallet ? -1 : 1)).map((t) => ({ wallet: t.wallet, balance: t.balance, bought: t.bought }));
    return { pool: { ...this.poolRow(p), prizeBps: p.prizeBps, seedBps: p.seedBps, feeBps: p.feeBps, feeTreasury: p.feeTreasury, seedTreasury: p.seedTreasury }, holders };
  }

  async sessions(since: Date, limit: number): Promise<AdminSessionsDto> {
    const byWallet = new Map<string, AdminSessionsDto['rows'][number]>();
    for (const s of [...this.db.signIns].reverse().filter((x) => x.at.getTime() >= since.getTime())) {   // insertion order = time order here
      const row = byWallet.get(s.wallet);
      if (row) row.signIns++;
      else byWallet.set(s.wallet, { wallet: s.wallet, lastAt: s.at.getTime(), signIns: 1, ip: s.ip, userAgent: s.userAgent });
    }
    const all = [...byWallet.values()].sort((a, b) => b.lastAt - a.lastAt || (a.wallet < b.wallet ? -1 : 1));
    return { rows: all.slice(0, limit), truncated: all.length > limit };
  }

  async topRiders(limit: number): Promise<{ wallet: string; totals: StatsTotals }[]> {
    return [...this.db.playerStats.entries()].filter(([, r]) => r.totals.rides > 0).sort(([wa, a], [wb, b]) => b.totals.metres - a.totals.metres || (wa < wb ? -1 : 1)).slice(0, limit).map(([wallet, r]) => ({ wallet, totals: r.totals }));
  }
}
