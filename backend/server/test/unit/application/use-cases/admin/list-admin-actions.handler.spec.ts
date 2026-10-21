import { ListAdminActionsHandler } from '../../../../../src/application/use-cases/admin/list-admin-actions/list-admin-actions.handler.js';
import { ListAdminActionsQuery } from '../../../../../src/application/use-cases/admin/list-admin-actions/list-admin-actions.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ListAdminActionsHandler', () => {
  it('the audit log newest first, times as epoch ms', async () => {
    const ctx = unitContext();
    await ctx.adminActions.insert({ wallet: 'A', action: 'verdict.override', target: 'r1', detail: { to: 'verified' }, requestId: 'q1', at: ctx.now() });
    ctx.clock.advance(5);
    await ctx.adminActions.insert({ wallet: 'A', action: 'verdict.override', target: 'r2', detail: { to: 'rejected' }, requestId: null, at: ctx.now() });
    const rows = (await new ListAdminActionsHandler(ctx.adminActions).execute(new ListAdminActionsQuery(10))).rows;
    expect(rows.map((r) => [r.target, r.at])).toEqual([['r2', ctx.clock.ms], ['r1', ctx.clock.ms - 5000]]);
    expect(rows[1]).toMatchObject({ wallet: 'A', action: 'verdict.override', detail: { to: 'verified' }, requestId: 'q1' });
  });

  it('reading the audit log writes a read.audit row after the snapshot', async () => {
    const ctx = unitContext();
    const listed = await new ListAdminActionsHandler(ctx.adminActions, ctx.clock).execute(new ListAdminActionsQuery(10, 'ADMIN'));
    expect(listed.rows).toEqual([]);
    expect(ctx.db.adminActions.at(-1)).toMatchObject({ wallet: 'ADMIN', action: 'read.audit', role: 'admin', afterState: { limit: 10, rows: 0 } });
  });
});
