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

/** Every row a player or a ride can write, one statement – used by `db:reset` and the integration tests. `economy.HonkPart` stays: it is the cab catalog seeded by migration, not a player's data. Refuses any database not named `*_test` unless `force` is passed (the CLI also refuses in production). */
export async function truncateAllTables(prisma: Db, options: TruncateOptions = {}): Promise<void> {
  const name = await connectedDatabase(prisma);
  if (!options.force && !name.endsWith('_test')) throw new Error(`refusing to truncate "${name}": only databases named *_test are wiped automatically (db:reset passes force)`);
  const stmt =
    'TRUNCATE "admin"."AlertOutbox", "admin"."AdminProposal", "admin"."AdminAction", "stats"."RideResult", "player"."SignIn", "telemetry"."RideBatch", "verdict"."RideReplayFlag", "verdict"."RideReplay", "verdict"."RideVerdict", "achievement"."AchievementMint", "achievement"."AchievementUnlock", "economy"."Payment", "economy"."Pledge", "live"."LiveChat", "ride"."RideAppeal", "ride"."Ride", "economy"."Round", "economy"."Series", "economy"."Pool", "economy"."PoolPayout", "economy"."TicketOrder", "economy"."PromoCode", "economy"."PromoRedemption", "economy"."PromoRideGrant", "player"."AuthChallenge", "player"."WeeklyTicket", "player"."AirdropClaim", "player"."Player", "player"."RideTicket", "player"."TicketGrant", "player"."CosmeticUnlock", "player"."CosmeticEquip", "economy"."ChainCursor", "economy"."ChainEvent", "live"."RideEvent", "live"."RideMute", "live"."DonationOrder", "stats"."GlobalStats", "stats"."PlayerStats", "stats"."DailyStats", "player"."GameSetting", "player"."Referral", "player"."ReferralCode", "ride"."DailySeed", "economy"."HonkBurn", "economy"."HonkVisual", "economy"."HonkMint", "economy"."HonkAccount", "economy"."HonkSupply", "asset"."EditorMcpCall", "asset"."EditorJobEvent", "asset"."EditorJob", "asset"."EntityRevision", "asset"."Entity" RESTART IDENTITY CASCADE';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await prisma.$executeRawUnsafe(stmt);
      return;
    } catch (err: unknown) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code: string }).code : '';
      if (attempt < 4 && (code === '40P01' || String(err).includes('deadlock'))) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}
