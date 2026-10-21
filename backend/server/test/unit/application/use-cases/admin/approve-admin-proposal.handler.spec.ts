import { ApproveAdminProposalHandler } from '../../../../../src/application/use-cases/admin/approve-proposal/approve-admin-proposal.handler.js';
import { ApproveAdminProposalCommand } from '../../../../../src/application/use-cases/admin/approve-proposal/approve-admin-proposal.command.js';
import { AdminApprovalService } from '../../../../../src/application/services/admin-approval.service.js';
import { MemoryAdminProposalRepository } from '../../../../support/in-memory/memory-repositories.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

describe('ApproveAdminProposalHandler', () => {
  it('a different admin applies a pending proposal', async () => {
    const ctx = unitContext(unitRules({ approvalMode: 'dual' }));
    const proposals = new MemoryAdminProposalRepository(ctx.db);
    const approval = new AdminApprovalService(proposals, ctx.rules, ctx.clock, ctx.entropy);
    const bus = { execute: async () => ({ ok: true }) };
    const handler = new ApproveAdminProposalHandler(approval, bus as never, ctx.adminActions, ctx.clock);
    const id = await approval.open('/api/admin/config', 'config', 'ADMIN', { path: '/api/admin/config', body: { note: null } }, null);
    expect(await handler.execute(new ApproveAdminProposalCommand(id, 'OTHER', 'req'))).toEqual({ ok: true, status: 'applied', id });
    expect(ctx.db.adminActions.at(-1)?.action).toBe('proposal.approve');
  });
});
