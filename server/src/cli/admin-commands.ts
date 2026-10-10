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
import { ClockPort } from '../application/ports/shared/clock.port.js';
import { RegisterPoolCommand } from '../application/use-cases/pools/register-pool/register-pool.command.js';
import type { PoolProps } from '../domain/economy/pool.types.js';
import { EnvService } from '../infrastructure/config/env.service.js';
import { RegisterPoolFromChainCommand } from '../application/use-cases/pools/register-pool-from-chain/register-pool-from-chain.command.js';
import { CrankPoolsCommand } from '../application/use-cases/chain/crank-pools/crank-pools.command.js';
import { parsePoolRegister, parsePoolSeed, parsePromoCreate, parseTicketsGrant, parseStatsReconcile, parseVerdictRejudge, type PoolSeedArgs } from './admin-args.js';
import { RejudgeRidesCommand } from '../application/use-cases/admin/rejudge-rides/rejudge-rides.command.js';
import { ReconcileStatsCommand } from '../application/use-cases/stats/reconcile-stats/reconcile-stats.command.js';
import { SweepTelemetryCommand } from '../application/use-cases/telemetry/sweep-telemetry/sweep-telemetry.command.js';
import { SweepSignInsCommand } from '../application/use-cases/auth/sweep-sign-ins/sweep-sign-ins.command.js';

/** The application layer without HTTP: the admin commands go through the same handlers (validation, locks, audit lines) as the API. */
@Module({ imports: [EnvModule, ApplicationModule] })
class CliModule {}

async function withBuses<T>(fn: (buses: { commands: CommandBus; queries: QueryBus; app: INestApplicationContext }) => Promise<T>): Promise<number> {
  let app: INestApplicationContext | null = null;
  try {
    app = await NestFactory.createApplicationContext(CliModule, { logger: ['error'] });
    const result = await fn({ commands: app.get(CommandBus), queries: app.get(QueryBus), app });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(`[cli] ${error instanceof DomainError ? `${error.errorCode}: ${error.message}` : error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
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
      return typeof input === 'string' ? usage(input) : withBuses(({ commands }) => commands.execute(new CreatePromoCommand(input)));
    }
    case 'promo:list':
      return withBuses(({ queries }) => queries.execute<ListPromosQuery, PromoListDto>(new ListPromosQuery()));
    case 'promo:disable':
      return args.length === 1 ? withBuses(({ commands }) => commands.execute(new DisablePromoCommand(args[0] as string))) : usage('give exactly one code');
    case 'tickets:grant': {
      const g = parseTicketsGrant(args);
      return typeof g === 'string' ? usage(g) : withBuses(({ commands }) => commands.execute(new GrantTicketsCommand(g.wallet, g.poolId, g.count, g.note)));
    }
    case 'pool:seed': {
      const p = parsePoolSeed(args);
      return typeof p === 'string' ? usage(p) : withBuses(({ commands, app }) => {
        const env = app.get(EnvService);
        if (env.isProduction) throw new Error('pool:seed is for development – in production pools come from the chain (pool:register)');
        return commands.execute(new RegisterPoolCommand(seededPool(p, app.get(ClockPort).now(), env)));
      });
    }
    case 'pool:register': {
      const r = parsePoolRegister(args);
      return typeof r === 'string' ? usage(r) : withBuses(({ commands }) => commands.execute(new RegisterPoolFromChainCommand(r.poolId, r.label)));
    }
    case 'pool:crank':
      return args.length ? usage('pool:crank takes no arguments') : withBuses(({ commands }) => commands.execute(new CrankPoolsCommand()));
    case 'verdict:rejudge': {
      const r = parseVerdictRejudge(args);
      return typeof r === 'string' ? usage(r) : withBuses(({ commands }) => commands.execute(new RejudgeRidesCommand({ verdict: r.verdict, since: r.since, limit: r.limit }, r.dryRun, 'cli')));
    }
    case 'stats:reconcile': {
      const r = parseStatsReconcile(args);
      return typeof r === 'string' ? usage(r) : withBuses(({ commands }) => commands.execute(new ReconcileStatsCommand(r.wallet, r.fix)));
    }
    case 'retention:sweep':
      return args.length ? usage('retention:sweep takes no arguments') : withBuses(async ({ commands }) => ({ telemetry: await commands.execute(new SweepTelemetryCommand()), signIns: await commands.execute(new SweepSignInsCommand()) }));
    default:
      return null;
  }
}

const DAY = 86_400_000;
const PLACEHOLDER = '11111111111111111111111111111111'; // the system program – never a real treasury, just a valid address

/** A development pool with a fake (but valid) address – NOT on chain: tickets come from promo codes / tickets:grant, the explorer link leads nowhere. */
function seededPool(a: PoolSeedArgs, now: Date, env: EnvService): Omit<PoolProps, 'rideSeed'> {
  const address = bs58.encode(Buffer.from(`dev-pool-${a.id}`.padEnd(32, '.')));
  return {
    id: a.id, address, tier: a.tier, label: a.label ?? `${a.tier.toUpperCase()} · dev pool ${a.id}`, priceLamports: a.priceLamports, minTickets: a.minTickets, maxTickets: a.maxTickets,
    maxPerWallet: a.maxPerWallet, prepDeadline: new Date(now.getTime() + a.prepDays * DAY), playDeadline: new Date(now.getTime() + a.playDays * DAY),
    prizeBps: 7000, seedBps: 2000, feeBps: 1000, feeTreasury: env.feeTreasury || PLACEHOLDER, seedTreasury: env.seedTreasury || PLACEHOLDER,
    status: a.status, ticketsSold: a.sold, buyers: Math.min(a.sold, 1), vaultLamports: a.sold * a.priceLamports, sponsored: 0, roundId: null, createdAt: now, syncedAt: null,
  };
}
