import type { CommandBus } from '@nestjs/cqrs';
import { ReferralExpiryScheduler } from '../../../../src/application/referral/referral-expiry.scheduler.js';
import type { ConvoyService } from '../../../../src/application/referral/convoy.service.js';

describe('ReferralExpiryScheduler', () => {
  it('asks the convoy service to expire due rows from the clock', async () => {
    const expireDue = vi.fn(async () => ({ deletedPending: 2, expiredActive: 1 }));
    const execute = vi.fn(async () => 0);
    const scheduler = new ReferralExpiryScheduler({ expireDue } as unknown as ConvoyService, { execute } as unknown as CommandBus);
    await expect(scheduler.sweep()).resolves.toEqual({ deletedPending: 2, expiredActive: 1 });
    expect(expireDue).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });
});
