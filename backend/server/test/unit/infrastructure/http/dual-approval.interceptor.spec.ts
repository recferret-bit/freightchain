import { of } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { DualApprovalInterceptor } from '../../../../src/infrastructure/http/interceptors/dual-approval.interceptor.js';
import { AdminApprovalService } from '../../../../src/application/services/admin-approval.service.js';
import { PendingApprovalError } from '../../../../src/domain/shared/errors.js';

describe('DualApprovalInterceptor', () => {
  it('does nothing in single mode and opens a proposal in dual mode', async () => {
    const single = new DualApprovalInterceptor({ dual: () => false } as unknown as AdminApprovalService);
    const next = { handle: () => of({ ok: true }) };
    const ctx = (body: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ method: 'POST', path: '/api/admin/settings', url: '/api/admin/settings', body, player: { wallet: 'A' } }) }) }) as never;
    expect(await lastValueFrom(single.intercept(ctx({ key: 'referral_ride_cap_lamports' }), next))).toEqual({ ok: true });
    const dual = new DualApprovalInterceptor({ dual: () => true, open: async () => 'prop-1' } as unknown as AdminApprovalService);
    await expect(lastValueFrom(dual.intercept(ctx({ key: 'referral_ride_cap_lamports' }), next))).rejects.toBeInstanceOf(PendingApprovalError);
    expect(await lastValueFrom(dual.intercept(ctx({ key: 'free_on_signup' }), next))).toEqual({ ok: true });
  });
});
