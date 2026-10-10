import { HoldPoolPayoutCommand } from '../../../src/application/use-cases/admin/hold-pool-payout/hold-pool-payout.command.js';
import { ListAdminPoolsQuery } from '../../../src/application/use-cases/admin/list-admin-pools/list-admin-pools.query.js';
import { RequestActionChallengeCommand } from '../../../src/application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { AdminPoolsHttpController } from '../../../src/presentation/admin/admin-pools.http.controller.js';
import { poolHoldBodySchema, poolHoldChallengeBodySchema, poolHoldParamsSchema } from '../../../src/presentation/admin/dto/admin-pools.dto.js';
import { busMock } from '../../support/bus.js';

const W = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';

describe('AdminPoolsHttpController', () => {
  it('dispatches every route to the bus with the admin wallet and the request id', async () => {
    const commands = busMock({ ok: true }), queries = busMock({ pools: [] });
    const c = new AdminPoolsHttpController(commands.bus, queries.bus);
    expect(await c.pools()).toEqual({ pools: [] });
    expect(queries.last()).toEqual(new ListAdminPoolsQuery());
    await c.holdChallenge({ wallet: W }, poolHoldParamsSchema.parse({ id: '7' }), poolHoldChallengeBodySchema.parse({ action: 'pool_hold', hold: true, note: ' look at rank 2 ' }));
    expect(commands.last()).toEqual(new RequestActionChallengeCommand(W, { action: 'pool_hold', poolId: 7, hold: true, note: 'look at rank 2' }));
    await c.hold({ wallet: W }, poolHoldParamsSchema.parse({ id: '7' }), poolHoldBodySchema.parse({ hold: false, note: '', signature: 'SIG' }), 'req-1');
    expect(commands.last()).toEqual(new HoldPoolPayoutCommand(W, 7, false, null, 'req-1', 'SIG'));
  });

  it('DTOs: a u32 pool id, a boolean decision, a note of at most 300 characters, a signature on the write', () => {
    for (const bad of [{ id: '-1' }, { id: 'x' }, { id: String(2 ** 32) }]) expect(poolHoldParamsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(poolHoldChallengeBodySchema.safeParse({ action: 'pool_hold', hold: 'yes', note: null }).success).toBe(false);
    expect(poolHoldChallengeBodySchema.safeParse({ action: 'pool_hold', hold: true, note: 'x'.repeat(301) }).success).toBe(false);
    expect(poolHoldBodySchema.safeParse({ hold: true, note: null, signature: '' }).success).toBe(false);
  });
});
