import { GameSettingsService } from '../../../../src/application/services/game-settings.service.js';
import { unitContext } from '../../../support/unit-context.js';

describe('GameSettingsService', () => {
  it('an empty table resolves to the code defaults, and the next read sees an upsert', async () => {
    const ctx = unitContext();
    const svc = new GameSettingsService(ctx.settingsRepo);
    expect(await svc.current()).toEqual({ freeOnSignup: 10, freeRidesDailyMax: 5, weeklyTicketHours: 1, editorJobsPerDay: 40, editorMaxSteps: 24, editorMaxOutputTokens: 32000, editorMaxInputKTokens: 500, editorJobsParallel: 5 });
    await ctx.settingsRepo.upsert('free_rides_daily_max', 2);
    expect((await svc.current()).freeRidesDailyMax).toBe(2);
  });

  it('a stored value outside 0..100_000 falls back to the code default', async () => {
    const ctx = unitContext();
    await ctx.settingsRepo.upsert('free_on_signup', 100_001);
    await ctx.settingsRepo.upsert('free_rides_daily_max', 0);
    expect(await ctx.settings.current()).toMatchObject({ freeOnSignup: 10, freeRidesDailyMax: 0 });
  });
});
