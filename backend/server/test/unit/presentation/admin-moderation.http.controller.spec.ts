import { AdminModerationHttpController } from '../../../src/presentation/admin/admin-moderation.http.controller.js';
import { AdminModerationCommand } from '../../../src/application/use-cases/admin/moderate/admin-moderation.command.js';
import { ApproveAdminProposalCommand } from '../../../src/application/use-cases/admin/approve-proposal/approve-admin-proposal.command.js';
import { busMock } from '../../support/bus.js';

describe('AdminModerationHttpController', () => {
  it('dispatches hide, ban, rules, config and approve', async () => {
    const commands = busMock({ ok: true, status: 'applied' });
    const c = new AdminModerationHttpController(commands.bus);
    const who = { wallet: 'MOD' };
    await c.hide(who, { eventId: 4 }, 'r1');
    expect(commands.last()).toEqual(new AdminModerationCommand('chat.hide', 'MOD', '4', { hidden: true }, 'r1'));
    await c.ban(who, { wallet: 'W'.padEnd(32, '1') }, { ban: false }, 'r2');
    await c.rules({ wallet: 'ADMIN' }, { poolId: 3, note: null }, 'r-rules');
    await c.config({ wallet: 'ADMIN' }, { note: 'x' }, 'r3');
    await c.approve({ wallet: 'OTHER' }, { id: '00000000-0000-4000-8000-000000000001' }, 'r4');
    expect(commands.last()).toEqual(new ApproveAdminProposalCommand('00000000-0000-4000-8000-000000000001', 'OTHER', 'r4'));
  });
});
