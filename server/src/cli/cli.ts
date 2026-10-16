import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { EnvService } from '../infrastructure/config/env.service.js';
import { truncateAllTables } from '../infrastructure/prisma/truncate.js';
import { runAdmin } from './admin-commands.js';
import { runEntitiesExport } from './entities-export.js';

export const HELP = `
Freight Chain server CLI

Usage:
  node dist/cli/index.js <command>

Commands:
  migrate      Apply the database migrations (prisma migrate deploy)
  db:reset     Truncate every table (refused in production)
  promo:create CODE <effect> [--desc TEXT] [--start DATE] [--expires DATE] [--max N] [--per-wallet N] [--note TEXT]
               A promo code with ONE effect: --ride 1h|4h|8h (one free shift, not a purchase, once per wallet, no TEN4)
               · --tier 1h|4h|8h --credits N [--pool ID] (tickets into the tier's live pool, or the pinned pool). --free-rides is retired. Cab parts are minted by burning TEN4.
  promo:list   Every promo code with its usage
  promo:disable CODE
               Stop a code (tickets already granted stay)
  tickets:grant WALLET POOL_ID COUNT [--note TEXT]
               Gift tickets into a live pool (clamped at its per-wallet cap; audited)
  pool:seed --id N --tier 1h|4h|8h [--status open|active] [--price LAMPORTS] [--min N] [--max N] [--per-wallet N] [--prep-days D] [--play-days D] [--sold N] [--label TEXT]
                     1h with no --min uses 20 (ride-tier.ts). Pass --min to seed a smaller test pool.
               DEVELOPMENT ONLY (refused in production): a pool in the mirror that is not on chain – for the lobby without a deployed program
  pool:register POOL_ID [--label TEXT]
               Read the pool's account from chain (TICKET_PROGRAM_ID, SOLANA_RPC) into the mirror, or refresh it – the chain wins; --label renames it
  pool:crank   One crank pass now (CRANK_SECRET): open each tier's next pool when its slot has come, fail missed pools, expire unsettled ones, refund their tickets, close refunded pools – by the chain clock
  pool:payout [--pool N]  One payout pass now (PAYOUT_SECRET = the program's payout key): pools past their review window – every ride decided, then the verified top 20 paid and the pool closed
  pool:pledges One pledge pass now (the pledge job after each payout pass): follow every open pledge on chain; with PAYOUT_SECRET settle the attested ones, refund those of pools that are over
  achievement:mint [--retry]  One badge-mint pass now (ACHIEVEMENT_MINT_SECRET + ACHIEVEMENT_TREE + ACHIEVEMENT_COLLECTION): queue old-enough unlocks, resolve transactions in flight, mint soulbound cNFTs; --retry puts failed rows back first
  verdict:rejudge [--status unjudged|verified|flagged|rejected|all] [--since DATE] [--limit N] [--dry-run]
               Judge completed shifts again at the CURRENT verdict rules (after a threshold change) – an admin's decision is kept, a swept recording skipped; audited
  replay:verify [--ride ID] [--limit N] [--concurrency C]
               Run one replay verification pass over a ride or the pending queue (10 Hz ReplayEngine + @freightchain/shared)
  replay:worker [--limit N] [--concurrency C] [--interval-ms MS]
               Run the continuous replay verification worker daemon (polls ReplayQueuePort and verdict.RideReplay pending rows)
  pool:attention --pool N
               The pool-level attention checks (distance outlier, shared sign-in IP, a new wallet in the top 3): marks those rides' verdicts flagged
               with pool-* reasons so they stay UNDER REVIEW – an admin's decision is never touched; idempotent; logged (event pool-attention)
  stats:reconcile [--wallet ADDRESS] [--fix]
               Recompute the statistics tables (per rider + global) from the rides and donations, report the drift; --fix rewrites the rows (quiet app, see docs/statistics.md)
  entities:export
               Write every PUBLISHED 3D model revision back over client/shared/entity/seed/<kind>/<id>.js and regenerate seed/index.js (review + commit it)
  retention:sweep
               Run the retention sweeps now (recordings older than TELEMETRY_RETENTION_DAYS, sign-ins older than SIGNIN_RETENTION_DAYS)
  --help       Show this help
`;

/** The server's own prisma binary (cwd is the server folder when started via npm scripts). */
function prismaBin(): string {
  const local = join(process.cwd(), 'node_modules', '.bin', 'prisma');
  return existsSync(local) ? local : 'prisma';
}

/** The validated environment – the same rules as the server (DATABASE_URL required, production checks). */
function environment(): EnvService | null {
  try {
    return new EnvService();
  } catch (error) {
    console.error(`[cli] ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function runMigrate(): number {
  if (!environment()) return 1;
  console.log('[cli] prisma migrate deploy …');
  return spawnSync(prismaBin(), ['migrate', 'deploy'], { stdio: 'inherit' }).status ?? 1; // the child inherits the environment
}

export async function runDbReset(): Promise<number> {
  const env = environment();
  if (!env) return 1;
  if (env.isProduction) {
    console.error('[cli] refusing to truncate the database in production');
    return 1;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });
  try {
    await truncateAllTables(prisma, { force: true }); // explicit: this IS the developer asking to wipe their database
    console.log('[cli] all tables truncated.');
    return 0;
  } catch (error) {
    console.error(`[cli] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const [command] = argv;
  if (command === 'migrate') return runMigrate();
  if (command === 'db:reset') return runDbReset();
  if (command === 'entities:export') { const env = environment(); return env ? runEntitiesExport(env) : 1; }
  const admin = command ? await runAdmin(command, argv.slice(1)) : null;
  if (admin !== null) return admin;
  console.log(HELP);
  return command === undefined || command === '--help' ? 0 : 1;
}
