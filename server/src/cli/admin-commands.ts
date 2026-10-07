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
import { parsePromoCreate, parseTicketsGrant } from './admin-args.js';

/** The application layer without HTTP: the admin commands go through the same handlers (validation, locks, audit lines) as the API. */
@Module({ imports: [EnvModule, ApplicationModule] })
class CliModule {}

async function withBuses<T>(fn: (buses: { commands: CommandBus; queries: QueryBus }) => Promise<T>): Promise<number> {
  let app: INestApplicationContext | null = null;
  try {
    app = await NestFactory.createApplicationContext(CliModule, { logger: ['error'] });
    const result = await fn({ commands: app.get(CommandBus), queries: app.get(QueryBus) });
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
    default:
      return null;
  }
}
