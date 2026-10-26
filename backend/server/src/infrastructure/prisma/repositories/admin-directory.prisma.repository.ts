import { Injectable } from '@nestjs/common';
import type { Pool as PoolRow } from '@prisma/client';
import type { AdminPlayerRowDto, AdminPoolDetailDto, AdminPoolRowDto, AdminSessionsDto } from '../../../domain/admin/admin.dto.js';
import type { StatsTotals } from '../../../domain/stats/stats.js';
import { AdminDirectoryPort } from '../../../application/ports/admin/admin-directory.port.js';
import { PrismaService } from '../prisma.service.js';

const poolRow = (p: PoolRow): AdminPoolRowDto => ({
  id: p.id, address: p.address, tier: p.tier, label: p.label, status: p.status, priceLamports: Number(p.priceLamports), minTickets: p.minTickets, maxTickets: p.maxTickets, maxPerWallet: p.maxPerWallet,
  ticketsSold: p.ticketsSold, buyers: p.buyers, vaultLamports: Number(p.vaultLamports), sponsored: Number(p.sponsored), roundId: p.roundId, rideSeed: p.rideSeed,
  prepDeadline: p.prepDeadline.getTime(), playDeadline: p.playDeadline.getTime(), createdAt: p.createdAt.getTime(), syncedAt: p.syncedAt?.getTime() ?? null,
});

@Injectable()
export class AdminDirectoryPrismaRepository extends AdminDirectoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async players(q: string | undefined, limit: number): Promise<AdminPlayerRowDto[]> {
    const rows = await this.prisma.player.findMany({
      where: q ? { wallet: { startsWith: q } } : {}, orderBy: [{ createdAt: 'desc' }, { wallet: 'asc' }], take: limit, include: { stats: { select: { rides: true } } },   // index (createdAt)
    });
    const wallets = rows.map((p) => p.wallet);
    // two aggregates over just this page's wallets, instead of a relation include that loads every ticket and sign-in row of every listed rider
    const [tickets, signIns] = await Promise.all([
      this.prisma.rideTicket.groupBy({ by: ['wallet'], where: { wallet: { in: wallets } }, _sum: { balance: true } }),
      this.prisma.$queryRaw<{ wallet: string; at: Date }[]>`SELECT DISTINCT ON ("wallet") "wallet", "at" FROM "player"."SignIn" WHERE "wallet" = ANY(${wallets}) ORDER BY "wallet", "at" DESC`,   // index (wallet, at)
    ]);
    const unused = new Map(tickets.map((t) => [t.wallet, t._sum.balance ?? 0]));
    const last = new Map(signIns.map((s) => [s.wallet, s.at.getTime()]));
    return rows.map((p) => ({
      wallet: p.wallet, freeRides: p.freeRides, freeRidesMax: p.freeRidesMax, createdAt: p.createdAt.getTime(), lastSignInAt: last.get(p.wallet) ?? null, rides: p.stats?.rides ?? 0, tickets: unused.get(p.wallet) ?? 0,
    }));
  }

  async sessions(since: Date, limit: number): Promise<AdminSessionsDto> {
    const groups = await this.prisma.signIn.groupBy({
      by: ['wallet'], where: { at: { gte: since } }, _max: { at: true }, _count: { _all: true }, orderBy: [{ _max: { at: 'desc' } }, { wallet: 'asc' }], take: limit + 1,   // index (at)
    });
    const page = groups.slice(0, limit);
    const wallets = page.map((g) => g.wallet);
    const latest = await this.prisma.$queryRaw<{ wallet: string; ipHash: string | null }[]>`SELECT DISTINCT ON ("wallet") "wallet", "ipHash" FROM "player"."SignIn" WHERE "wallet" = ANY(${wallets}) AND "at" >= ${since} ORDER BY "wallet", "at" DESC, "id" DESC`;
    const where = new Map(latest.map((r) => [r.wallet, r]));
    return {
      rows: page.map((g) => ({ wallet: g.wallet, lastAt: g._max.at!.getTime(), signIns: g._count._all, ipHash: where.get(g.wallet)?.ipHash ?? null })),
      truncated: groups.length > limit,
    };
  }

  async pools(limit: number): Promise<AdminPoolRowDto[]> {
    return (await this.prisma.pool.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit })).map(poolRow);
  }

  async pool(id: number): Promise<AdminPoolDetailDto | null> {
    const p = await this.prisma.pool.findUnique({ where: { id } });
    if (!p) return null;
    const holders = await this.prisma.rideTicket.findMany({ where: { poolId: id }, orderBy: [{ bought: 'desc' }, { wallet: 'asc' }], select: { wallet: true, balance: true, bought: true } });
    return { pool: { ...poolRow(p), prizeBps: p.prizeBps, seedBps: p.seedBps, feeBps: p.feeBps, feeTreasury: p.feeTreasury, seedTreasury: p.seedTreasury }, holders };
  }

  async topRiders(limit: number): Promise<{ wallet: string; totals: StatsTotals }[]> {
    const rows = await this.prisma.playerStats.findMany({ where: { rides: { gt: 0 } }, orderBy: [{ metres: 'desc' }, { wallet: 'asc' }], take: limit });
    return rows.map((r) => ({
      wallet: r.wallet,
      totals: {
        rides: r.rides, ridesFree: r.ridesFree, ridesPaid: r.ridesPaid, ridesCompleted: r.ridesCompleted, seconds: r.seconds, metres: r.metres, crashesVehicle: r.crashesVehicle,
        crashesBuilding: r.crashesBuilding, donations: r.donations, donationLamports: Number(r.donationLamports),
      },
    }));
  }
}
