import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StatsRepositoryPort, type StatsRow } from '../../../application/ports/stats/stats.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { EMPTY_STATS, addStats, toStatsDto, utcDay, type DailyStatsDto, type StatsTotals } from '../../../domain/stats/stats.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

type Row = { rides: number; ridesFree: number; ridesPaid: number; ridesCompleted: number; seconds: number; metres: number; crashesVehicle: number; crashesBuilding: number; donations: number; donationLamports: bigint };
const toTotals = (r: Row): StatsTotals => ({
  rides: r.rides, ridesFree: r.ridesFree, ridesPaid: r.ridesPaid, ridesCompleted: r.ridesCompleted, seconds: r.seconds, metres: r.metres, crashesVehicle: r.crashesVehicle, crashesBuilding: r.crashesBuilding,
  donations: r.donations, donationLamports: Number(r.donationLamports),
});
const num = (v: unknown): number => Number(v ?? 0);

@Injectable()
export class StatsPrismaRepository extends StatsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** Two atomic upserts – `x = x + n` inside the statement, so racing rides never lose an update – the rider's row FIRST, the global row second (the lock
      order every writer keeps, so two writers cannot deadlock on the hot global row). Outside a transaction the pair gets its own. */
  async add(wallet: string, d: StatsTotals, now: Date, tx?: TransactionHandle, at: Date = now): Promise<void> {
    if (!tx) {   // no caller transaction (a donation): take the player row first like every ride writer, else the stats insert's FK check can deadlock with a ride ending
      await this.prisma.$transaction(async (t) => {
        await t.$executeRaw`SELECT 1 FROM "player"."Player" WHERE "wallet" = ${wallet} FOR UPDATE`;
        await this.add(wallet, d, now, t as unknown as TransactionHandle, at);
      });
      return;
    }
    const db = clientFor(this.prisma, tx);
    const lamports = BigInt(d.donationLamports);
    const stamp = Prisma.sql`(${now}::timestamptz AT TIME ZONE 'UTC')`;   // TIMESTAMP(3) holds UTC whatever the session's time zone
    await db.$executeRaw`
      INSERT INTO "stats"."PlayerStats" ("wallet", "rides", "ridesFree", "ridesPaid", "ridesCompleted", "seconds", "metres", "crashesVehicle", "crashesBuilding", "donations", "donationLamports", "updatedAt")
      VALUES (${wallet}, ${d.rides}, ${d.ridesFree}, ${d.ridesPaid}, ${d.ridesCompleted}, ${d.seconds}, ${d.metres}, ${d.crashesVehicle}, ${d.crashesBuilding}, ${d.donations}, ${lamports}, ${stamp})
      ON CONFLICT ("wallet") DO UPDATE SET
        "rides" = "PlayerStats"."rides" + EXCLUDED."rides", "ridesFree" = "PlayerStats"."ridesFree" + EXCLUDED."ridesFree", "ridesPaid" = "PlayerStats"."ridesPaid" + EXCLUDED."ridesPaid", "ridesCompleted" = "PlayerStats"."ridesCompleted" + EXCLUDED."ridesCompleted",
        "seconds" = "PlayerStats"."seconds" + EXCLUDED."seconds", "metres" = "PlayerStats"."metres" + EXCLUDED."metres",
        "crashesVehicle" = "PlayerStats"."crashesVehicle" + EXCLUDED."crashesVehicle", "crashesBuilding" = "PlayerStats"."crashesBuilding" + EXCLUDED."crashesBuilding",
        "donations" = "PlayerStats"."donations" + EXCLUDED."donations", "donationLamports" = "PlayerStats"."donationLamports" + EXCLUDED."donationLamports",
        "updatedAt" = EXCLUDED."updatedAt"`;
    await db.$executeRaw`
      INSERT INTO "stats"."GlobalStats" ("id", "rides", "ridesFree", "ridesPaid", "ridesCompleted", "seconds", "metres", "crashesVehicle", "crashesBuilding", "donations", "donationLamports", "updatedAt")
      VALUES (1, ${d.rides}, ${d.ridesFree}, ${d.ridesPaid}, ${d.ridesCompleted}, ${d.seconds}, ${d.metres}, ${d.crashesVehicle}, ${d.crashesBuilding}, ${d.donations}, ${lamports}, ${stamp})
      ON CONFLICT ("id") DO UPDATE SET
        "rides" = "GlobalStats"."rides" + EXCLUDED."rides", "ridesFree" = "GlobalStats"."ridesFree" + EXCLUDED."ridesFree", "ridesPaid" = "GlobalStats"."ridesPaid" + EXCLUDED."ridesPaid", "ridesCompleted" = "GlobalStats"."ridesCompleted" + EXCLUDED."ridesCompleted",
        "seconds" = "GlobalStats"."seconds" + EXCLUDED."seconds", "metres" = "GlobalStats"."metres" + EXCLUDED."metres",
        "crashesVehicle" = "GlobalStats"."crashesVehicle" + EXCLUDED."crashesVehicle", "crashesBuilding" = "GlobalStats"."crashesBuilding" + EXCLUDED."crashesBuilding",
        "donations" = "GlobalStats"."donations" + EXCLUDED."donations", "donationLamports" = "GlobalStats"."donationLamports" + EXCLUDED."donationLamports",
        "updatedAt" = EXCLUDED."updatedAt"`;
    await db.$executeRaw`
      INSERT INTO "stats"."DailyStats" ("day", "rides", "ridesFree", "ridesPaid", "ridesCompleted", "seconds", "metres", "crashesVehicle", "crashesBuilding", "donations", "donationLamports", "updatedAt")
      VALUES (${utcDay(at)}::date, ${d.rides}, ${d.ridesFree}, ${d.ridesPaid}, ${d.ridesCompleted}, ${d.seconds}, ${d.metres}, ${d.crashesVehicle}, ${d.crashesBuilding}, ${d.donations}, ${lamports}, ${stamp})
      ON CONFLICT ("day") DO UPDATE SET
        "rides" = "DailyStats"."rides" + EXCLUDED."rides", "ridesFree" = "DailyStats"."ridesFree" + EXCLUDED."ridesFree", "ridesPaid" = "DailyStats"."ridesPaid" + EXCLUDED."ridesPaid", "ridesCompleted" = "DailyStats"."ridesCompleted" + EXCLUDED."ridesCompleted",
        "seconds" = "DailyStats"."seconds" + EXCLUDED."seconds", "metres" = "DailyStats"."metres" + EXCLUDED."metres",
        "crashesVehicle" = "DailyStats"."crashesVehicle" + EXCLUDED."crashesVehicle", "crashesBuilding" = "DailyStats"."crashesBuilding" + EXCLUDED."crashesBuilding",
        "donations" = "DailyStats"."donations" + EXCLUDED."donations", "donationLamports" = "DailyStats"."donationLamports" + EXCLUDED."donationLamports",
        "updatedAt" = EXCLUDED."updatedAt"`;
  }

  async findPlayer(wallet: string): Promise<StatsRow | null> {
    const row = await this.prisma.playerStats.findUnique({ where: { wallet } });
    return row ? { totals: toTotals(row), updatedAt: row.updatedAt } : null;
  }

  async findGlobal(): Promise<StatsRow | null> {
    const row = await this.prisma.globalStats.findUnique({ where: { id: 1 } });
    return row ? { totals: toTotals(row), updatedAt: row.updatedAt } : null;
  }

  async countDrivers(): Promise<number> {
    return this.prisma.playerStats.count({ where: { rides: { gt: 0 } } });
  }

  async listPlayers(wallet?: string): Promise<Map<string, StatsTotals>> {
    const rows = await this.prisma.playerStats.findMany({ where: wallet ? { wallet } : undefined });
    return new Map(rows.map((r) => [r.wallet, toTotals(r)]));
  }

  /** The rule, in SQL: a started ride that ended counts (its metres, seconds, crashes); every donation event counts on the ride owner's row, its lamports only when a transfer paid it. */
  async recompute(wallet?: string): Promise<Map<string, StatsTotals>> {
    const only = wallet ? Prisma.sql`AND r."wallet" = ${wallet}` : Prisma.empty;
    const rides = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT r."wallet", COUNT(*) AS "rides", COUNT(*) FILTER (WHERE r."tier" = 'free') AS "ridesFree", COUNT(*) FILTER (WHERE r."tier" <> 'free') AS "ridesPaid", COUNT(*) FILTER (WHERE r."status" = 'completed') AS "ridesCompleted", COALESCE(SUM(r."driveSeconds"), 0) AS "seconds",
             COALESCE(SUM(r."lastS"), 0) AS "metres", COALESCE(SUM(r."crashesVehicle"), 0) AS "crashesVehicle", COALESCE(SUM(r."crashesBuilding"), 0) AS "crashesBuilding"
      FROM "ride"."Ride" r WHERE r."startedAt" IS NOT NULL AND r."status" IN ('completed', 'abandoned', 'failed') ${only} GROUP BY r."wallet"`;
    const gifts = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT r."wallet", COUNT(*) AS "donations", COALESCE(SUM(e."lamports") FILTER (WHERE e."signature" IS NOT NULL), 0) AS "donationLamports"
      FROM "live"."RideEvent" e JOIN "ride"."Ride" r ON r."id" = e."rideId" WHERE e."kind" = 'donation' ${only} GROUP BY r."wallet"`;
    const out = new Map<string, StatsTotals>();
    for (const r of rides) {
      out.set(String(r.wallet), { ...EMPTY_STATS, rides: num(r.rides), ridesFree: num(r.ridesFree), ridesPaid: num(r.ridesPaid), ridesCompleted: num(r.ridesCompleted), seconds: num(r.seconds), metres: num(r.metres), crashesVehicle: num(r.crashesVehicle), crashesBuilding: num(r.crashesBuilding) });
    }
    for (const g of gifts) {
      const w = String(g.wallet);
      out.set(w, addStats(out.get(w) ?? EMPTY_STATS, { ...EMPTY_STATS, donations: num(g.donations), donationLamports: num(g.donationLamports) }));
    }
    return out;
  }

  async replace(truth: Map<string, StatsTotals>, now: Date, scope: string | null, daily?: Map<string, StatsTotals>): Promise<void> {
    await this.prisma.$transaction(async (db) => {
      const wallets = [...truth.keys()].sort();
      for (const w of wallets) await db.$executeRaw`SELECT 1 FROM "player"."Player" WHERE "wallet" = ${w} FOR UPDATE`;   // the player row first (ordered, so two repairs cannot deadlock), like every writer
      for (const [wallet, t] of truth) {
        const data = { ...t, donationLamports: BigInt(t.donationLamports), updatedAt: now };
        await db.playerStats.upsert({ where: { wallet }, create: { wallet, ...data }, update: data });
      }
      await db.playerStats.deleteMany({ where: scope ? { wallet: scope, NOT: { wallet: { in: wallets } } } : { wallet: { notIn: wallets } } });
      const sum = await db.playerStats.aggregate({ _sum: { rides: true, ridesFree: true, ridesPaid: true, ridesCompleted: true, seconds: true, metres: true, crashesVehicle: true, crashesBuilding: true, donations: true, donationLamports: true } });
      const s = sum._sum;
      const g = { rides: s.rides ?? 0, ridesFree: s.ridesFree ?? 0, ridesPaid: s.ridesPaid ?? 0, ridesCompleted: s.ridesCompleted ?? 0, seconds: s.seconds ?? 0, metres: s.metres ?? 0, crashesVehicle: s.crashesVehicle ?? 0, crashesBuilding: s.crashesBuilding ?? 0, donations: s.donations ?? 0, donationLamports: s.donationLamports ?? 0n, updatedAt: now };
      await db.globalStats.upsert({ where: { id: 1 }, create: { id: 1, ...g }, update: g });
      if (daily) {
        for (const [day, t] of daily) {
          const data = { ...t, donationLamports: BigInt(t.donationLamports), updatedAt: now };
          await db.dailyStats.upsert({ where: { day: new Date(`${day}T00:00:00.000Z`) }, create: { day: new Date(`${day}T00:00:00.000Z`), ...data }, update: data });
        }
        await db.dailyStats.deleteMany({ where: { day: { notIn: [...daily.keys()].map((k) => new Date(`${k}T00:00:00.000Z`)) } } });
      }
    });
  }

  async listDaily(days: number, until: Date): Promise<DailyStatsDto[]> {
    const from = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate() - (days - 1)));
    const rows = await this.prisma.dailyStats.findMany({ where: { day: { gte: from } }, orderBy: { day: 'asc' } });
    return rows.map((r) => ({ day: utcDay(r.day), ...toStatsDto(toTotals(r)) }));
  }

  async listAllDaily(): Promise<Map<string, StatsTotals>> {
    return new Map((await this.prisma.dailyStats.findMany()).map((r) => [utcDay(r.day), toTotals(r)]));
  }

  async recomputeDaily(): Promise<Map<string, StatsTotals>> {
    const rides = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT to_char(r."endedAt", 'YYYY-MM-DD') AS "day", COUNT(*) AS "rides", COUNT(*) FILTER (WHERE r."tier" = 'free') AS "ridesFree", COUNT(*) FILTER (WHERE r."tier" <> 'free') AS "ridesPaid",
             COUNT(*) FILTER (WHERE r."status" = 'completed') AS "ridesCompleted", COALESCE(SUM(r."driveSeconds"), 0) AS "seconds", COALESCE(SUM(r."lastS"), 0) AS "metres",
             COALESCE(SUM(r."crashesVehicle"), 0) AS "crashesVehicle", COALESCE(SUM(r."crashesBuilding"), 0) AS "crashesBuilding"
      FROM "ride"."Ride" r WHERE r."startedAt" IS NOT NULL AND r."endedAt" IS NOT NULL AND r."status" IN ('completed', 'abandoned', 'failed') GROUP BY 1`;
    const gifts = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT to_char(e."createdAt", 'YYYY-MM-DD') AS "day", COUNT(*) AS "donations", COALESCE(SUM(e."lamports") FILTER (WHERE e."signature" IS NOT NULL), 0) AS "donationLamports"
      FROM "live"."RideEvent" e WHERE e."kind" = 'donation' GROUP BY 1`;
    const out = new Map<string, StatsTotals>();
    for (const r of rides) {
      out.set(String(r.day), { ...EMPTY_STATS, rides: num(r.rides), ridesFree: num(r.ridesFree), ridesPaid: num(r.ridesPaid), ridesCompleted: num(r.ridesCompleted), seconds: num(r.seconds), metres: num(r.metres), crashesVehicle: num(r.crashesVehicle), crashesBuilding: num(r.crashesBuilding) });
    }
    for (const g of gifts) {
      const day = String(g.day);
      out.set(day, addStats(out.get(day) ?? EMPTY_STATS, { ...EMPTY_STATS, donations: num(g.donations), donationLamports: num(g.donationLamports) }));
    }
    return out;
  }
}
