import { AdminApprovalService } from '../../../../src/application/services/admin-approval.service.js';
import { ForbiddenError } from '../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../support/unit-context.js';
import { MemoryAdminProposalRepository } from '../../../support/in-memory/memory-repositories.js';

describe('AdminApprovalService', () => {
  it('refuses the proposer and accepts a different wallet inside 30 minutes', async () => {
    const ctx = unitContext(unitRules({ approvalMode: 'dual' }));
    const proposals = new MemoryAdminProposalRepository(ctx.db);
    const service = new AdminApprovalService(proposals, ctx.rules, ctx.clock, ctx.entropy);
    expect(service.dual()).toBe(true);
    const id = await service.open('setting.update', 'referral_ride_cap_lamports', 'ADMIN', { path: '/api/admin/settings', body: { key: 'referral_ride_cap_lamports', value: 1 } }, 'req');
    await expect(service.approve(id, 'ADMIN')).rejects.toMatchObject({ errorCode: 'dual_approval_distinct_wallet_required' });
    await expect(service.approve(id, 'ADMIN')).rejects.toBeInstanceOf(ForbiddenError);
    const row = await service.approve(id, 'OTHER');
    expect(row.proposerWallet).toBe('ADMIN');
    const late = await service.open('pool.hold', '1', 'ADMIN', {}, null);
    ctx.clock.advance(31 * 60);
    await expect(service.approve(late, 'OTHER')).rejects.toMatchObject({ errorCode: 'expired' });
  });
});
