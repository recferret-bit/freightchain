import { LiveChatService } from '../../../../../src/application/live/live-chat.service.js';
import { AdminModerationHandler } from '../../../../../src/application/use-cases/admin/moderate/admin-moderation.handler.js';
import { AdminModerationCommand } from '../../../../../src/application/use-cases/admin/moderate/admin-moderation.command.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('AdminModerationHandler', () => {
  it('audits a chat hide and records chain config as squads-only', async () => {
    const ctx = unitContext();
    const chat = new LiveChatService(ctx.replayAccess, ctx.rideEvents, ctx.rideMutes, ctx.adminActions, ctx.rules, ctx.clock);
    const handler = new AdminModerationHandler(ctx.adminActions, ctx.clock, chat);
    expect(await handler.execute(new AdminModerationCommand('chat.hide', 'MOD', '9', { hidden: true }, 'r'))).toEqual({ ok: true, status: 'applied' });
    expect(await handler.execute(new AdminModerationCommand('program.config', 'ADMIN', 'config', { note: null }, null))).toEqual({ ok: true, status: 'squads' });
    expect(ctx.db.adminActions.map((row) => row.action)).toEqual(['chat.hide', 'program.config']);
    expect(ctx.db.adminActions[0]?.afterState).toEqual({ hidden: true });
  });
});
