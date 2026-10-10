import { GetOfflineRidesHandler } from '../../../../../src/application/use-cases/offline/get-offline-rides/get-offline-rides.handler.js';
import { GetOfflineRidesQuery } from '../../../../../src/application/use-cases/offline/get-offline-rides/get-offline-rides.query.js';
import { unitContext } from '../../../../support/unit-context.js';

const FP = 'a'.repeat(64);

describe('GetOfflineRidesHandler', () => {
  it('reports the allowance and does not insert a row', async () => {
    const ctx = unitContext();
    const dto = await new GetOfflineRidesHandler(ctx.offlineRides, ctx.settings, ctx.rules).execute(new GetOfflineRidesQuery(null, FP, '  '));
    expect(dto).toMatchObject({ signedIn: false, allowed: true, claimed: false, remaining: 3, usedFingerprint: 0, usedIp: 0, limitFingerprint: 3, limitIp: 10, minSeconds: 10, completeDist: 70 });
    expect(ctx.db.offlineUses).toEqual([]);
  });

  it('a signed-in wallet is reported and still spends nothing', async () => {
    const ctx = unitContext();
    const dto = await new GetOfflineRidesHandler(ctx.offlineRides, ctx.settings, ctx.rules).execute(new GetOfflineRidesQuery('w', FP, '1.2.3.4'));
    expect(dto).toMatchObject({ signedIn: true, allowed: false, claimed: false, remaining: 3 });
    expect(ctx.db.offlineUses).toEqual([]);
  });
});
