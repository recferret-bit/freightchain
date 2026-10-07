import { AdminHttpController } from '../../../src/presentation/admin/admin.http.controller.js';
import { GetAdminLogsQuery } from '../../../src/application/use-cases/admin/get-admin-logs/get-admin-logs.query.js';
import { GetAdminOverviewQuery } from '../../../src/application/use-cases/admin/get-admin-overview/get-admin-overview.query.js';
import { GetAdminRideQuery } from '../../../src/application/use-cases/admin/get-admin-ride/get-admin-ride.query.js';
import { ListAdminActionsQuery } from '../../../src/application/use-cases/admin/list-admin-actions/list-admin-actions.query.js';
import { ListAdminRidesQuery } from '../../../src/application/use-cases/admin/list-admin-rides/list-admin-rides.query.js';
import { ListSignInsQuery } from '../../../src/application/use-cases/admin/list-sign-ins/list-sign-ins.query.js';
import { OverrideVerdictCommand } from '../../../src/application/use-cases/admin/override-verdict/override-verdict.command.js';
import { RejudgeRideCommand } from '../../../src/application/use-cases/admin/rejudge-ride/rejudge-ride.command.js';
import { actionsQuerySchema, adminRidesQuerySchema, logsQuerySchema, overrideBodySchema, signInsQuerySchema } from '../../../src/presentation/admin/dto/admin.dto.js';
import { busMock } from '../../support/bus.js';

const W = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';

describe('AdminHttpController', () => {
  it('dispatches every route to its query / command (the admin wallet and the request id go with the override)', async () => {
    const commands = busMock({ status: 'verified' }), queries = busMock({ rows: [] });
    const c = new AdminHttpController(commands.bus, queries.bus);
    await c.overview(); expect(queries.last()).toEqual(new GetAdminOverviewQuery());
    const filter = adminRidesQuerySchema.parse({ verdict: 'flagged' });
    await c.rides(filter); expect(queries.last()).toEqual(new ListAdminRidesQuery({ limit: 50, verdict: 'flagged' }));
    await c.ride({ id: 'r1' }); expect(queries.last()).toEqual(new GetAdminRideQuery('r1'));
    await c.signIns({ limit: 10, wallet: W }); expect(queries.last()).toEqual(new ListSignInsQuery(10, W));
    await c.actions({ limit: 5 }); expect(queries.last()).toEqual(new ListAdminActionsQuery(5));
    await c.logs(logsQuerySchema.parse({ level: 'warn', q: 'req-1' })); expect(queries.last()).toEqual(new GetAdminLogsQuery({ limit: 200, minLevel: 'warn', text: 'req-1' }));
    expect(await c.override({ wallet: 'ADMIN' }, { id: 'r1' }, overrideBodySchema.parse({ decision: 'verified', note: ' looks human ' }), 'req-9')).toEqual({ status: 'verified' });
    expect(commands.last()).toEqual(new OverrideVerdictCommand('ADMIN', 'r1', 'verified' as never, 'looks human', 'req-9'));
    await c.rejudge({ wallet: 'ADMIN' }, { id: 'r1' }, 'req-10'); expect(commands.last()).toEqual(new RejudgeRideCommand('ADMIN', 'r1', 'req-10'));
  });

  describe('DTO schemas', () => {
    it('rides: optional wallet / status / verdict (empty = none), a capped limit', () => {
      expect(adminRidesQuerySchema.parse({})).toEqual({ limit: 50 });
      expect(adminRidesQuerySchema.parse({ wallet: '', status: '', verdict: '', limit: '7' })).toEqual({ limit: 7 });
      expect(adminRidesQuerySchema.parse({ wallet: W, status: 'completed', verdict: 'none' })).toEqual({ limit: 50, wallet: W, status: 'completed', verdict: 'none' });
      for (const bad of [{ wallet: 'nope' }, { status: 'won' }, { verdict: 'maybe' }, { limit: '0' }, { limit: '201' }]) expect(adminRidesQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    });
    it('sign-ins / actions / logs', () => {
      expect(signInsQuerySchema.parse({})).toEqual({ limit: 100 });
      expect(actionsQuerySchema.parse({ limit: '3' })).toEqual({ limit: 3 });
      expect(logsQuerySchema.parse({ level: '', q: '' })).toEqual({ limit: 200 });
      expect(logsQuerySchema.safeParse({ level: 'loud' }).success).toBe(false);
    });
    it('override: verified or rejected only; a blank note is no note; notes are capped', () => {
      expect(overrideBodySchema.parse({ decision: 'rejected', note: '  ' })).toEqual({ decision: 'rejected', note: null });
      expect(overrideBodySchema.parse({ decision: 'verified' })).toEqual({ decision: 'verified', note: null });
      for (const bad of [{ decision: 'flagged' }, {}, { decision: 'verified', note: 'x'.repeat(501) }]) expect(overrideBodySchema.safeParse(bad).success).toBe(false);
    });
  });
});
