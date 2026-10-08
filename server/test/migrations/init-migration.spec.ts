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
    for (const schema of ['player', 'ride', 'economy', 'achievement', 'telemetry', 'verdict', 'admin']) expect(sql).toContain(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    const models = schemaModels();
    expect(models.map((m) => m.model).sort()).toEqual(['AchievementUnlock', 'AdminAction', 'AuthChallenge', 'ChainCursor', 'ChainEvent', 'Payment', 'Player', 'Pool', 'PromoCode', 'PromoRedemption', 'Ride', 'RideBatch', 'RideTicket', 'RideVerdict', 'Round', 'SignIn', 'SponsoredTx', 'TicketGrant', 'TicketOrder']);
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
  });

  it('is forward-only: nothing is dropped, renamed or truncated', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|INDEX)\b/i);
    expect(sql).not.toMatch(/\bRENAME\b|\bTRUNCATE\b/i);
  });
});
