import { GetSettingsHandler } from '../../../../../src/application/use-cases/admin/get-settings/get-settings.handler.js';
import { GetSettingsQuery } from '../../../../../src/application/use-cases/admin/get-settings/get-settings.query.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetSettingsHandler', () => {
  it('returns the resolved knobs, including a code default for a missing row', async () => {
    const ctx = unitContext();
    await ctx.settingsRepo.upsert('free_on_signup', 7);
    expect(await new GetSettingsHandler(ctx.settings).execute(new GetSettingsQuery())).toEqual({
      freeOnSignup: 7, freeRidesDailyMax: 5,
    });
  });
});
