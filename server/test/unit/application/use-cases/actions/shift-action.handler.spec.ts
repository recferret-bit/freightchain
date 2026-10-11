import type { CommandBus, QueryBus } from '@nestjs/cqrs';
import { buyTx } from '../../../../../src/domain/actions/action-card.js';
import { ServiceUnavailableError } from '../../../../../src/domain/shared/errors.js';
import type { RulesConfigPort } from '../../../../../src/application/ports/config/rules-config.port.js';
import type { PoolRepositoryPort } from '../../../../../src/application/ports/economy/pool.repository.port.js';
import type { PlayerRepositoryPort } from '../../../../../src/application/ports/players/player.repository.port.js';
import type { ClockPort } from '../../../../../src/application/ports/shared/clock.port.js';
import { CreateTicketOrderCommand } from '../../../../../src/application/use-cases/tickets/create-ticket-order/create-ticket-order.command.js';
import { GetTicketPaymentQuery } from '../../../../../src/application/use-cases/tickets/get-ticket-payment/get-ticket-payment.query.js';
import { GetShiftActionHandler, PrepareShiftActionHandler } from '../../../../../src/application/use-cases/actions/shift-action.handler.js';
import { GetShiftActionQuery } from '../../../../../src/application/use-cases/actions/get-shift-action.query.js';
import { PrepareShiftActionCommand } from '../../../../../src/application/use-cases/actions/prepare-shift-action.command.js';
import { aPool } from '../../../../support/pools.js';

const NOW = new Date('2030-06-01T00:00:00Z');
const ACCOUNT = '4GzacGtTe67wnkpJBs7pngcRfsFckbHvzmAUNL6Jchmz';
const rules = (over: { paymentMode?: 'program' | 'transfer'; programId?: string } = {}): RulesConfigPort => ({ get: () => ({ paymentMode: 'transfer', programId: '', appOrigin: 'https://freightchain.fun', ...over }) }) as RulesConfigPort;
const clock = { now: () => NOW } as ClockPort;
const pools = (rows: ReturnType<typeof aPool>[]): PoolRepositoryPort => ({ listLive: async () => rows }) as unknown as PoolRepositoryPort;
const players = (allowed: boolean | null): PlayerRepositoryPort => ({ findByWallet: async () => (allowed === null ? null : { paidPlayAllowed: allowed }) }) as unknown as PlayerRepositoryPort;

describe('shift actions', () => {
  it('transfer mode, and a program with nothing selling, offer no buy button', async () => {
    const selling = aPool({ id: 7, tier: '1h', priceLamports: 50_000_000 }, NOW);
    const off = await new GetShiftActionHandler(rules(), pools([selling]), clock).execute(new GetShiftActionQuery(null));
    expect(off.links.actions.some((a) => a.type === 'transaction')).toBe(false);
    const none = await new GetShiftActionHandler(rules({ paymentMode: 'program', programId: 'Prog' }), pools([]), clock).execute(new GetShiftActionQuery('1h'));
    expect(none.description).toMatch(/No paid pool is on sale/);
    const on = await new GetShiftActionHandler(rules({ paymentMode: 'program', programId: 'Prog' }), pools([selling]), clock).execute(new GetShiftActionQuery(null));
    expect(on.links.actions[0]).toMatchObject({ type: 'transaction', href: '/api/actions/shift/1h' });
  });

  it('a buy is one ticket through the order and its payment, or a refusal before that', async () => {
    const selling = aPool({ id: 7, tier: '1h' }, NOW);
    const commands = { execute: vi.fn(async () => ({ id: 'order-1' })) };
    const queries = { execute: vi.fn(async () => ({ transaction: 'AAAA' })) };
    const handler = (rows = [selling], mode: 'program' | 'transfer' = 'program', allowed: boolean | null = true) => new PrepareShiftActionHandler(
      rules({ paymentMode: mode, programId: mode === 'program' ? 'Prog' : '' }), pools(rows), clock, players(allowed), commands as unknown as CommandBus, queries as unknown as QueryBus,
    );
    await expect(handler([selling], 'transfer').execute(new PrepareShiftActionCommand(ACCOUNT, '1h'))).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(handler([]).execute(new PrepareShiftActionCommand(ACCOUNT, '1h'))).rejects.toMatchObject({ errorCode: 'not_sellable' });
    await expect(handler([selling], 'program', null).execute(new PrepareShiftActionCommand(ACCOUNT, '1h'))).rejects.toMatchObject({ errorCode: 'agreements_required' });
    expect(commands.execute).not.toHaveBeenCalled();
    const tx = await handler().execute(new PrepareShiftActionCommand(ACCOUNT, '1h'));
    expect(tx).toEqual(buyTx('https://freightchain.fun', '1h', 7, 'AAAA'));
    expect(commands.execute).toHaveBeenCalledWith(new CreateTicketOrderCommand(ACCOUNT, 7, 1));
    expect(queries.execute).toHaveBeenCalledWith(new GetTicketPaymentQuery(ACCOUNT, 'order-1'));
  });
});
