import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { EnvService } from '../infrastructure/config/env.service.js';
import { truncateAllTables } from '../infrastructure/prisma/truncate.js';
import { runAdmin } from './admin-commands.js';

export const HELP = `
Freight Chain server CLI

Usage:
  node dist/cli/index.js <command>

Commands:
  migrate      Apply the database migrations (prisma migrate deploy)
  db:reset     Truncate every table (refused in production)
  promo:create CODE --tier 1h|4h|8h --credits N [--max N] [--per-wallet N] [--expires YYYY-MM-DD] [--pool ID] [--note TEXT]
               A promo code: N free tickets per redemption into the tier's live pool (or the pinned --pool)
  promo:list   Every promo code with its usage
  promo:disable CODE
               Stop a code (tickets already granted stay)
  tickets:grant WALLET POOL_ID COUNT [--note TEXT]
               Gift tickets into a live pool (clamped at its per-wallet cap; audited)
  pool:seed --id N --tier 1h|4h|8h [--status open|active] [--price LAMPORTS] [--min N] [--max N] [--per-wallet N] [--prep-days D] [--play-days D] [--sold N] [--label TEXT]
               DEVELOPMENT ONLY (refused in production): a pool in the mirror that is not on chain – for the lobby without a deployed program
  pool:register POOL_ID [--label TEXT]
               Read the pool's account from chain (TICKET_PROGRAM_ID, SOLANA_RPC) into the mirror, or refresh it – the chain wins; --label renames it
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
  const admin = command ? await runAdmin(command, argv.slice(1)) : null;
  if (admin !== null) return admin;
  console.log(HELP);
  return command === undefined || command === '--help' ? 0 : 1;
}
