import { AdminHttpController } from '../../../src/presentation/admin/admin.http.controller.js';
import { GetAdminLogsQuery } from '../../../src/application/use-cases/admin/get-admin-logs/get-admin-logs.query.js';
import { GetAdminOverviewQuery } from '../../../src/application/use-cases/admin/get-admin-overview/get-admin-overview.query.js';
import { GetAdminRideQuery } from '../../../src/application/use-cases/admin/get-admin-ride/get-admin-ride.query.js';
import { ListAdminActionsQuery } from '../../../src/application/use-cases/admin/list-admin-actions/list-admin-actions.query.js';
import { ListAdminReplaysQuery } from '../../../src/application/use-cases/admin/list-admin-replays/list-admin-replays.query.js';
import { ListAdminRidesQuery } from '../../../src/application/use-cases/admin/list-admin-rides/list-admin-rides.query.js';
import { ListSignInsQuery } from '../../../src/application/use-cases/admin/list-sign-ins/list-sign-ins.query.js';
import { OverrideVerdictCommand } from '../../../src/application/use-cases/admin/override-verdict/override-verdict.command.js';
import { RejudgeRideCommand } from '../../../src/application/use-cases/admin/rejudge-ride/rejudge-ride.command.js';
import { actionChallengeBodySchema, actionsQuerySchema, adminReplaysQuerySchema, adminRidesQuerySchema, logsQuerySchema, overrideBodySchema, rejudgeBodySchema, signInsQuerySchema } from '../../../src/presentation/admin/dto/admin.dto.js';
import { RequestActionChallengeCommand } from '../../../src/application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { RequestAdminChallengeCommand } from '../../../src/application/use-cases/admin/request-admin-challenge/request-admin-challenge.command.js';
import { VerifyAdminSignInCommand } from '../../../src/application/use-cases/admin/verify-admin-signin/verify-admin-signin.command.js';
import { LogoutCommand } from '../../../src/application/use-cases/auth/logout/logout.command.js';
import { busMock } from '../../support/bus.js';

const W = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';

describe('AdminHttpController', () => {
  it('dispatches every route to its query / command (the admin wallet and the request id go with the override)', async () => {
    const commands = busMock({ status: 'verified' }), queries = busMock({ rows: [] });
    const c = new AdminHttpController(commands.bus, queries.bus);
    await c.nonce({ wallet: W }); expect(commands.last()).toEqual(new RequestAdminChallengeCommand(W));
    await c.verify({ wallet: W, signature: 'S' }, { ip: '1.2.3.4', userAgent: 'UA' }, 'req-1'); expect(commands.last()).toEqual(new VerifyAdminSignInCommand(W, 'S', { ip: '1.2.3.4', userAgent: 'UA' }, 'req-1'));
    await c.logout(); expect(commands.last()).toEqual(new LogoutCommand());
    await c.overview(); expect(queries.last()).toEqual(new GetAdminOverviewQuery());
    const filter = adminRidesQuerySchema.parse({ verdict: 'flagged' });
    await c.rides(filter); expect(queries.last()).toEqual(new ListAdminRidesQuery({ limit: 50, verdict: 'flagged' }));
    const replayFilter = adminReplaysQuerySchema.parse({ status: 'flagged', paid: 'true' });
    await c.replays(replayFilter); expect(queries.last()).toEqual(new ListAdminReplaysQuery({ limit: 50, status: 'flagged', isPaid: true }));
    await c.ride({ id: 'r1' }); expect(queries.last()).toEqual(new GetAdminRideQuery('r1'));
    await c.signIns({ limit: 10, wallet: W }); expect(queries.last()).toEqual(new ListSignInsQuery(10, W));
    await c.actions({ limit: 5 }); expect(queries.last()).toEqual(new ListAdminActionsQuery(5));
    await c.logs(logsQuerySchema.parse({ level: 'warn', q: 'req-1' })); expect(queries.last()).toEqual(new GetAdminLogsQuery({ limit: 200, minLevel: 'warn', text: 'req-1' }));
    await c.challenge({ wallet: 'ADMIN' }, { id: 'r1' }, actionChallengeBodySchema.parse({ action: 'override', decision: 'rejected', note: ' bot ' }));
    expect(commands.last()).toEqual(new RequestActionChallengeCommand('ADMIN', { action: 'override', rideId: 'r1', decision: 'rejected' as never, note: 'bot' }));
    await c.challenge({ wallet: 'ADMIN' }, { id: 'r1' }, actionChallengeBodySchema.parse({ action: 'rejudge' }));
    expect(commands.last()).toEqual(new RequestActionChallengeCommand('ADMIN', { action: 'rejudge', rideId: 'r1' }));
    expect(await c.override({ wallet: 'ADMIN' }, { id: 'r1' }, overrideBodySchema.parse({ decision: 'verified', note: ' looks human ', signature: 'SIG' }), 'req-9')).toEqual({ status: 'verified' });
    expect(commands.last()).toEqual(new OverrideVerdictCommand('ADMIN', 'r1', 'verified' as never, 'looks human', 'req-9', 'SIG'));
    await c.rejudge({ wallet: 'ADMIN' }, { id: 'r1' }, rejudgeBodySchema.parse({ signature: 'SIG2' }), 'req-10'); expect(commands.last()).toEqual(new RejudgeRideCommand('ADMIN', 'r1', 'req-10', 'SIG2'));
  });

  describe('DTO schemas', () => {
    it('rides: optional wallet / status / verdict (empty = none), a capped limit', () => {
      expect(adminRidesQuerySchema.parse({})).toEqual({ limit: 50 });
      expect(adminRidesQuerySchema.parse({ wallet: '', status: '', verdict: '', limit: '7' })).toEqual({ limit: 7 });
      expect(adminRidesQuerySchema.parse({ wallet: W, status: 'completed', verdict: 'none' })).toEqual({ limit: 50, wallet: W, status: 'completed', verdict: 'none' });
      for (const bad of [{ wallet: 'nope' }, { status: 'won' }, { verdict: 'maybe' }, { limit: '0' }, { limit: '201' }]) expect(adminRidesQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    });
    it('replays / sign-ins / actions / logs', () => {
      expect(adminReplaysQuerySchema.parse({ status: '', paid: '' })).toEqual({ limit: 50 });
      expect(adminReplaysQuerySchema.parse({ status: 'rejected', paid: 'false', limit: '10' })).toEqual({ limit: 10, status: 'rejected', isPaid: false });
      expect(adminReplaysQuerySchema.safeParse({ status: 'unknown' }).success).toBe(false);
      expect(signInsQuerySchema.parse({})).toEqual({ limit: 100 });
      expect(actionsQuerySchema.parse({ limit: '3' })).toEqual({ limit: 3 });
      expect(logsQuerySchema.parse({ level: '', q: '' })).toEqual({ limit: 200 });
      expect(logsQuerySchema.safeParse({ level: 'loud' }).success).toBe(false);
    });
    it('override: verified or rejected only; a blank note is no note; notes are capped; a signature is required', () => {
      expect(overrideBodySchema.parse({ decision: 'rejected', note: '  ', signature: 's' })).toEqual({ decision: 'rejected', note: null, signature: 's' });
      expect(overrideBodySchema.parse({ decision: 'verified', signature: 's' })).toEqual({ decision: 'verified', note: null, signature: 's' });
      for (const bad of [{ decision: 'flagged', signature: 's' }, { signature: 's' }, { decision: 'verified', note: 'x'.repeat(501), signature: 's' }, { decision: 'verified' }, { decision: 'verified', signature: '' }]) expect(overrideBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(rejudgeBodySchema.safeParse({}).success).toBe(false);
    });
    it('challenge: an override (decision + the note normalised like the override\'s) or a re-judge', () => {
      expect(actionChallengeBodySchema.parse({ action: 'override', decision: 'verified', note: '  ' })).toEqual({ action: 'override', decision: 'verified', note: null });
      expect(actionChallengeBodySchema.parse({ action: 'rejudge' })).toEqual({ action: 'rejudge' });
      for (const bad of [{ action: 'override' }, { action: 'delete' }, {}]) expect(actionChallengeBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    });
  });
});
