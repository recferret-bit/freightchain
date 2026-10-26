import { replayWorkerLoop } from './replay-worker-loop.js';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApplicationModule } from '../application/application.module.js';
import { GrantTicketsCommand } from '../application/use-cases/players/grant-tickets/grant-tickets.command.js';
import { CreatePromoCommand } from '../application/use-cases/promos/create-promo/create-promo.command.js';
import { DisablePromoCommand } from '../application/use-cases/promos/disable-promo/disable-promo.command.js';
import { ListPromosQuery, type PromoListDto } from '../application/use-cases/promos/list-promos/list-promos.query.js';
import { DomainError } from '../domain/shared/errors.js';
import { EnvModule } from '../infrastructure/config/env.module.js';
import bs58 from 'bs58';
import { userInfo } from 'node:os';
import { AdminActionRepositoryPort } from '../application/ports/admin/admin-action.repository.port.js';
import { ClockPort } from '../application/ports/shared/clock.port.js';
import { CLI_AUDIT_SKIP, cliAuditRecord } from './cli-audit.js';
import { RegisterPoolCommand } from '../application/use-cases/pools/register-pool/register-pool.command.js';
import type { PoolProps } from '../domain/economy/pool.types.js';
import { EnvService } from '../infrastructure/config/env.service.js';
import { RegisterPoolFromChainCommand } from '../application/use-cases/pools/register-pool-from-chain/register-pool-from-chain.command.js';
import { CrankPoolsCommand } from '../application/use-cases/chain/crank-pools/crank-pools.command.js';
import { MintAchievementsCommand } from '../application/use-cases/achievements/mint-achievements/mint-achievements.command.js';
import { PayPoolsCommand } from '../application/use-cases/chain/pay-pools/pay-pools.command.js';
import { SyncPledgesCommand } from '../application/use-cases/pledges/sync-pledges/sync-pledges.command.js';
import { parsePoolPayout, parsePoolRegister, parsePoolSeed, parsePromoCreate, parseReplayVerify, parseReplayWorker, parseTicketsGrant, parseStatsReconcile, parseVerdictRejudge, type PoolSeedArgs, type ReplayWorkerArgs } from './admin-args.js';
import { parsePoolAttention } from './admin-args.js';
import { PoolAttentionService } from '../application/services/pool-attention.service.js';
import { RejudgeRidesCommand } from '../application/use-cases/admin/rejudge-rides/rejudge-rides.command.js';
import { RejudgeRideCommand } from '../application/use-cases/admin/rejudge-ride/rejudge-ride.command.js';
import { ProcessReplayQueueCommand } from '../application/use-cases/verdict/process-replay-queue/process-replay-queue.command.js';
import { ReconcileStatsCommand } from '../application/use-cases/stats/reconcile-stats/reconcile-stats.command.js';
import { SweepTelemetryCommand } from '../application/use-cases/telemetry/sweep-telemetry/sweep-telemetry.command.js';
import { SweepSignInsCommand } from '../application/use-cases/auth/sweep-sign-ins/sweep-sign-ins.command.js';

/** The application layer without HTTP: the admin commands go through the same handlers (validation, locks, audit lines) as the API. */
@Module({ imports: [EnvModule, ApplicationModule] })
class CliModule {}

async function withBuses<T>(command: string, args: readonly string[], fn: (buses: { commands: CommandBus; queries: QueryBus; app: INestApplicationContext }) => Promise<T>): Promise<number> {
  let app: INestApplicationContext | null = null;
  try {
    app = await NestFactory.createApplicationContext(CliModule, { logger: ['error'] });
    const result = await fn({ commands: app.get(CommandBus), queries: app.get(QueryBus), app });
    await noteCli(app, command, args);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(`[cli] ${error instanceof DomainError ? `${error.errorCode}: ${error.message}` : error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await app?.close();
  }
}

async function runReplayWorker(cfg: ReplayWorkerArgs): Promise<number> {
  let app: INestApplicationContext | null = null;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    app = await NestFactory.createApplicationContext(CliModule, { logger: ['error', 'warn', 'log'] });
    await noteCli(app, 'replay:worker', [`--limit`, String(cfg.limit)]);
    const commands = app.get(CommandBus);
    console.log(JSON.stringify({ event: 'replay-worker.start', limit: cfg.limit, concurrency: cfg.concurrency, intervalMs: cfg.intervalMs }));
    await replayWorkerLoop({
      processBatch: () => commands.execute(new ProcessReplayQueueCommand(cfg.limit, cfg.concurrency, null)),
      stopping: () => stopping, intervalMs: cfg.intervalMs,
      report: (event) => console.log(JSON.stringify(event)),
    });
    return 0;
  } catch (error) {
    console.error(`[cli] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await app?.close();
  }
}

const usage = (message: string): number => {
  console.error(`[cli] ${message} (see --help)`);
  return 1;
};

export async function runAdmin(command: string, args: readonly string[]): Promise<number | null> {
  switch (command) {
    case 'promo:create': {
      const input = parsePromoCreate(args);
      return typeof input === 'string' ? usage(input) : withBuses(command, args, ({ commands }) => commands.execute(new CreatePromoCommand(input)));
    }
    case 'promo:list':
      return withBuses(command, args, ({ queries }) => queries.execute<ListPromosQuery, PromoListDto>(new ListPromosQuery()));
    case 'promo:disable':
      return args.length === 1 ? withBuses(command, args, ({ commands }) => commands.execute(new DisablePromoCommand(args[0] as string))) : usage('give exactly one code');
    case 'tickets:grant': {
      const g = parseTicketsGrant(args);
      return typeof g === 'string' ? usage(g) : withBuses(command, args, ({ commands }) => commands.execute(new GrantTicketsCommand(g.wallet, g.poolId, g.count, g.note)));
    }
    case 'pool:seed': {
      const p = parsePoolSeed(args);
      return typeof p === 'string' ? usage(p) : withBuses(command, args, ({ commands, app }) => {
        const env = app.get(EnvService);
        if (env.isProduction) throw new Error('pool:seed is for development – in production pools come from the chain (pool:register)');
        return commands.execute(new RegisterPoolCommand(seededPool(p, app.get(ClockPort).now(), env)));
      });
    }
    case 'pool:register': {
      const r = parsePoolRegister(args);
      return typeof r === 'string' ? usage(r) : withBuses(command, args, ({ commands }) => commands.execute(new RegisterPoolFromChainCommand(r.poolId, r.label)));
    }
    case 'pool:crank':
      return args.length ? usage('pool:crank takes no arguments') : withBuses(command, args, ({ commands }) => commands.execute(new CrankPoolsCommand()));
    case 'pool:payout': {
      const r = parsePoolPayout(args);
      return typeof r === 'string' ? usage(r) : withBuses(command, args, ({ commands }) => commands.execute(new PayPoolsCommand(r.poolId)));
    }
    case 'pool:pledges':
      return args.length ? usage('pool:pledges takes no arguments') : withBuses(command, args, ({ commands }) => commands.execute(new SyncPledgesCommand()));
    case 'achievement:mint': {
      if (args.some((a) => a !== '--retry')) return usage('achievement:mint takes only --retry');
      return withBuses(command, args, ({ commands, app }) => { const env = app.get(EnvService); return commands.execute(new MintAchievementsCommand(env.achievementMintDelayMs, env.achievementMintBatch, args.includes('--retry'))); });
    }
    case 'verdict:rejudge': {
      const r = parseVerdictRejudge(args);
      return typeof r === 'string' ? usage(r) : withBuses(command, args, ({ commands }) => commands.execute(new RejudgeRidesCommand({ verdict: r.verdict, since: r.since, limit: r.limit }, r.dryRun, 'cli')));
    }
    case 'replay:verify': {
      const r = parseReplayVerify(args);
      return typeof r === 'string' ? usage(r) : withBuses(command, args, ({ commands }) => commands.execute(new ProcessReplayQueueCommand(r.limit, r.concurrency, r.rideId)));
    }
    case 'replay:worker': {
      const r = parseReplayWorker(args);
      return typeof r === 'string' ? usage(r) : runReplayWorker(r);
    }
    case 'pool:attention': {
      const r = parsePoolAttention(args);
      return typeof r === 'string' ? usage(r) : withBuses(command, args, ({ app }) => app.get(PoolAttentionService).markPool(r.poolId));
    }
    case 'stats:reconcile': {
      const r = parseStatsReconcile(args);
      return typeof r === 'string' ? usage(r) : withBuses(command, args, ({ commands }) => commands.execute(new ReconcileStatsCommand(r.wallet, r.fix)));
    }
    case 'retention:sweep':
      return args.length ? usage('retention:sweep takes no arguments') : withBuses(command, args, async ({ commands }) => ({ telemetry: await commands.execute(new SweepTelemetryCommand()), signIns: await commands.execute(new SweepSignInsCommand()) }));
    default:
      return null;
  }
}

async function noteCli(app: INestApplicationContext, command: string, args: readonly string[]): Promise<void> {
  if (CLI_AUDIT_SKIP.has(command)) return;
  await app.get(AdminActionRepositoryPort).insert(cliAuditRecord(userInfo().username, command, args, app.get(ClockPort).now()));
}

const DAY = 86_400_000;
const PLACEHOLDER = '11111111111111111111111111111111'; // the system program – never a real treasury, just a valid address

/** A development pool with a fake (but valid) address – NOT on chain: tickets come from promo codes / tickets:grant, the explorer link leads nowhere. */
function seededPool(a: PoolSeedArgs, now: Date, env: EnvService): Omit<PoolProps, 'rideSeed'> {
  const address = bs58.encode(Buffer.from(`dev-pool-${a.id}`.padEnd(32, '.')));
  return {
    id: a.id, address, tier: a.tier, label: a.label ?? `${a.tier.toUpperCase()} · dev pool ${a.id}`, priceLamports: a.priceLamports, minTickets: a.minTickets, maxTickets: a.maxTickets,
    maxPerWallet: a.maxPerWallet, prepDeadline: new Date(now.getTime() + a.prepDays * DAY), playDeadline: new Date(now.getTime() + a.playDays * DAY),
    payoutAt: new Date(now.getTime() + a.playDays * DAY), payoutState: 'pending', payoutNote: null, hold: null,
    prizeBps: 7000, seedBps: 2000, feeBps: 1000, feeTreasury: env.feeTreasury || PLACEHOLDER, seedTreasury: env.seedTreasury || PLACEHOLDER,
    status: a.status, ticketsSold: a.sold, buyers: Math.min(a.sold, 1), vaultLamports: a.sold * a.priceLamports, sponsored: 0, roundId: null, createdAt: now, syncedAt: null,
  };
}
