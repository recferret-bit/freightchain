import { AdminSettingsHttpController } from '../../../src/presentation/admin/admin-settings.http.controller.js';
import { AdjustFreeRidesCommand } from '../../../src/application/use-cases/admin/adjust-free-rides/adjust-free-rides.command.js';
import { GetSettingsQuery } from '../../../src/application/use-cases/admin/get-settings/get-settings.query.js';
import { RequestActionChallengeCommand } from '../../../src/application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { UpdateSettingCommand } from '../../../src/application/use-cases/admin/update-setting/update-setting.command.js';
import { adjustFreeRidesBodySchema, freeRidesChallengeBodySchema, settingChallengeBodySchema, updateSettingBodySchema } from '../../../src/presentation/admin/dto/admin-settings.dto.js';
import { busMock } from '../../support/bus.js';

const W = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';

describe('AdminSettingsHttpController', () => {
  it('dispatches every route to the bus, with the admin wallet and the request id', async () => {
    const commands = busMock({ ok: true }), queries = busMock({ freeOnSignup: 10 });
    const c = new AdminSettingsHttpController(commands.bus, queries.bus);
    expect(await c.settings()).toEqual({ freeOnSignup: 10 });
    expect(queries.last()).toEqual(new GetSettingsQuery());
    await c.settingChallenge({ wallet: W }, settingChallengeBodySchema.parse({ action: 'setting_update', key: 'free_on_signup', value: 7 }));
    expect(commands.last()).toEqual(new RequestActionChallengeCommand(W, { action: 'setting_update', key: 'free_on_signup', value: 7 }));
    await c.updateSetting({ wallet: W }, updateSettingBodySchema.parse({ key: 'free_on_signup', value: 7, signature: 'SIG' }), 'req-1');
    expect(commands.last()).toEqual(new UpdateSettingCommand(W, 'free_on_signup', 7, 'req-1', 'SIG'));
    await c.freeRidesChallenge({ wallet: W }, freeRidesChallengeBodySchema.parse({ action: 'free_rides_adjust', wallet: W, delta: -2 }));
    expect(commands.last()).toEqual(new RequestActionChallengeCommand(W, { action: 'free_rides_adjust', wallet: W, delta: -2 }));
    await c.adjustFreeRides({ wallet: W }, adjustFreeRidesBodySchema.parse({ wallet: W, delta: 100, signature: 'SIG2' }), 'req-2');
    expect(commands.last()).toEqual(new AdjustFreeRidesCommand(W, W, 100, 'req-2', 'SIG2'));
  });

  describe('DTO schemas', () => {
    it('a setting is a string key and an integer; the signature is required on the write', () => {
      expect(settingChallengeBodySchema.parse({ action: 'setting_update', key: 'free_on_signup', value: 0 })).toEqual({ action: 'setting_update', key: 'free_on_signup', value: 0 });
      expect(updateSettingBodySchema.parse({ key: 'k', value: 3, signature: 's' })).toEqual({ key: 'k', value: 3, signature: 's' });
      for (const bad of [{ action: 'setting_update', key: '', value: 1 }, { action: 'setting_update', key: 'k', value: 1.5 }, { action: 'other', key: 'k', value: 1 }, { key: 'k', value: 1 }]) {
        expect(settingChallengeBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      }
      expect(updateSettingBodySchema.safeParse({ key: 'k', value: 1, signature: '' }).success).toBe(false);
    });

    it('a free-ride delta is a non-zero integer inside ±100_000, for a wallet address', () => {
      expect(freeRidesChallengeBodySchema.parse({ action: 'free_rides_adjust', wallet: W, delta: -1 })).toEqual({ action: 'free_rides_adjust', wallet: W, delta: -1 });
      expect(adjustFreeRidesBodySchema.parse({ wallet: W, delta: 100_000, signature: 's' }).delta).toBe(100_000);
      for (const bad of [
        { action: 'free_rides_adjust', wallet: W, delta: 0 },
        { action: 'free_rides_adjust', wallet: 'nope', delta: 1 },
        { action: 'free_rides_adjust', wallet: W, delta: 100_001 },
        { action: 'free_rides_adjust', wallet: W, delta: -100_001 },
      ]) expect(freeRidesChallengeBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    });
  });
});
