import type { PrismaService } from './prisma.service.js';

export interface TruncateOptions {
  /** `db:reset` on a developer's own database: an explicit, deliberate opt-in. Tests never set it. */
  force?: boolean;
}

type Db = Pick<PrismaService, '$executeRawUnsafe' | '$queryRaw'>;

/** The database name of a connection URL ('' when it cannot be read). */
export function databaseNameOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

/** The database this client is ACTUALLY connected to – asked of the database itself, not of an environment variable that may have changed since the client was built. */
export async function connectedDatabase(prisma: Pick<PrismaService, '$queryRaw'>): Promise<string> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  return rows[0]?.name ?? '';
}

/** Every table of the app, one statement – used by `db:reset` and the integration tests. Refuses any database not named `*_test` unless `force` is passed (the CLI also refuses in production). */
export async function truncateAllTables(prisma: Db, options: TruncateOptions = {}): Promise<void> {
  const name = await connectedDatabase(prisma);
  if (!options.force && !name.endsWith('_test')) throw new Error(`refusing to truncate "${name}": only databases named *_test are wiped automatically (db:reset passes force)`);
  await prisma.$executeRawUnsafe(
    'TRUNCATE "admin"."AdminAction", "player"."SignIn", "telemetry"."RideBatch", "verdict"."RideVerdict", "achievement"."AchievementMint", "achievement"."AchievementUnlock", "economy"."Payment", "ride"."Ride", "economy"."Round", "player"."AuthChallenge", "player"."Player", "player"."TicketGrant", "economy"."PromoCode", "player"."CosmeticUnlock", "player"."CosmeticEquip", "economy"."ChainCursor", "economy"."ChainEvent", "live"."RideEvent", "live"."RideMute", "live"."DonationOrder", "stats"."GlobalStats", "stats"."PlayerStats", "stats"."DailyStats", "player"."GameSetting", "ride"."DailySeed" RESTART IDENTITY CASCADE',
  );
}
