import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER_DIR } from '../architecture/source-files.js';

/* The migration is hand-reviewed SQL: it must create exactly what the Prisma schema declares, be forward-only, and keep the unique keys the code relies on. */
const prismaDir = join(SERVER_DIR, 'prisma');
const migrations = readdirSync(join(prismaDir, 'migrations')).filter((n) => /^\d{14}_/.test(n)).sort();
const sql = migrations.map((m) => readFileSync(join(prismaDir, 'migrations', m, 'migration.sql'), 'utf8')).join('\n');

function schemaModels(): { schema: string; model: string }[] {
  const out: { schema: string; model: string }[] = [];
  for (const dir of readdirSync(prismaDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'migrations')) {
    for (const file of readdirSync(join(prismaDir, dir.name)).filter((n) => n.endsWith('.prisma'))) {
      const text = readFileSync(join(prismaDir, dir.name, file), 'utf8');
      for (const m of text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) out.push({ model: m[1] ?? '', schema: /@@schema\("(\w+)"\)/.exec(m[2] ?? '')?.[1] ?? '' });
    }
  }
  return out;
}

describe('prisma migrations', () => {
  it('uses the postgresql provider lock', () => {
    expect(readFileSync(join(prismaDir, 'migrations', 'migration_lock.toml'), 'utf8')).toMatch(/provider = "postgresql"/);
  });

  it('creates every PostgreSQL schema and every model of the Prisma schema', () => {
    for (const schema of ['player', 'ride', 'economy', 'achievement', 'telemetry', 'verdict', 'admin', 'live', 'stats', 'asset']) expect(sql).toContain(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    const models = schemaModels();
    expect(models.map((m) => m.model).sort()).toEqual(['AchievementMint', 'AchievementUnlock', 'AdminAction', 'AdminProposal', 'AirdropClaim', 'AlertOutbox', 'AuthChallenge', 'CampaignProviderBudget', 'ChainCursor', 'ChainEvent', 'ConvoyInvite', 'ConvoyLedger', 'ConvoyRide', 'CosmeticEquip', 'CosmeticUnlock', 'DailySeed', 'DailyStats', 'DonationOrder', 'EditorJob', 'EditorJobEvent', 'EditorMcpCall', 'Entity', 'EntityRevision', 'GameSetting', 'GlobalStats', 'HonkAccount', 'HonkBurn', 'HonkMint', 'HonkPart', 'HonkSupply', 'HonkVisual', 'LiveChat', 'Payment', 'Player', 'PlayerStats', 'Pledge', 'Pool', 'PoolPayout', 'PromoCode', 'PromoRedemption', 'PromoRideGrant', 'Referral', 'ReferralCode', 'Ride', 'RideAppeal', 'RideBatch', 'RideEvent', 'RideMiniGame', 'RideMute', 'RideReplay', 'RideReplayFlag', 'RideResult', 'RideTicket', 'RideVerdict', 'Round', 'Series', 'SgtTrustClaim', 'SignIn', 'TicketGrant', 'TicketOrder', 'WeeklyTicket']);
    for (const { schema, model } of models) expect(sql, `${schema}.${model}`).toContain(`CREATE TABLE "${schema}"."${model}"`);
  });

  it('keeps the unique keys the code relies on', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "Round_startsAt_key" ON "economy"\."Round"\("startsAt"\)/); // concurrent first request of a week
    expect(sql).toMatch(/CREATE UNIQUE INDEX "Payment_rideId_key" ON "economy"\."Payment"\("rideId"\)/); // a ride is paid once
    expect(sql).toMatch(/CONSTRAINT "Payment_pkey" PRIMARY KEY \("signature"\)/); // a transaction pays one ride
    expect(sql).toMatch(/PRIMARY KEY \("wallet",\s*"achievementId"\)/); // unlocks are idempotent
    expect(sql).toMatch(/"seq" BIGSERIAL NOT NULL/); // insertion order breaks timestamp ties
    expect(sql).toMatch(/CONSTRAINT "RideBatch_pkey" PRIMARY KEY \("rideId",\s*"seq"\)/); // a re-sent recording batch is a no-op
    expect(sql).toMatch(/CONSTRAINT "RideVerdict_pkey" PRIMARY KEY \("rideId"\)/); // one verdict per ride
    expect(sql).toMatch(/CONSTRAINT "RideReplay_pkey" PRIMARY KEY \("id"\)/); // replay verification runs
    expect(sql).toMatch(/CONSTRAINT "DailySeed_pkey" PRIMARY KEY \("tier","day"\)/); // one road per tier per day, however many first orders race
    expect(sql).toMatch(/CREATE UNIQUE INDEX "PoolPayout_poolId_wallet_kind_key" ON "economy"\."PoolPayout"\("poolId", "wallet", "kind"\)/); // a finisher can also be a referrer
  });

  it('is forward-only: nothing is dropped, renamed or truncated – except the reviewed removal of the retired gas sponsor, offline rate ledger and the unused staking-yield columns', () => {
    const RETIRED = /^DROP TABLE "(economy"\."SponsoredTx|player"\."OfflineRideUse)";$/gm; // gasless purchases and offline ride restriction ledger were removed
    const UNUSED_COLUMNS = /^ALTER TABLE "economy"\."Pool" DROP COLUMN "(stakedLamports|yieldEarned)";$/gm; // always 0: nothing stakes the vault (Oct 12)
    const PAYOUT_KEY = /^DROP INDEX IF EXISTS "economy"\."PoolPayout_poolId_wallet_key";$/gm; // replaced by (poolId, wallet, kind) so one wallet can be paid twice
    const SIGNIN_PRIVACY = /^ALTER TABLE "player"\."SignIn" DROP COLUMN "ip", DROP COLUMN "userAgent", ADD COLUMN "ipHash" TEXT;$/gm; // accepted privacy deletion; old raw data deliberately discarded
    expect(sql.replace(RETIRED, '').replace(UNUSED_COLUMNS, '').replace(PAYOUT_KEY, '').replace(SIGNIN_PRIVACY, '')).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|INDEX)\b/i);
    expect(sql).not.toMatch(/\bRENAME\b|\bTRUNCATE\b/i);
  });
});
