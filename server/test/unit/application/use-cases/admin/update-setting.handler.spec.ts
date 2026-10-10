import { UpdateSettingHandler } from '../../../../../src/application/use-cases/admin/update-setting/update-setting.handler.js';
import { UpdateSettingCommand } from '../../../../../src/application/use-cases/admin/update-setting/update-setting.command.js';
import { BadRequestError } from '../../../../../src/domain/shared/errors.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';
import { unitContext, type UnitContext } from '../../../../support/unit-context.js';

const handlerOf = (ctx: UnitContext) => new UpdateSettingHandler(ctx.settingsRepo, ctx.settings, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock);

describe('UpdateSettingHandler', () => {
  it('writes the signed value, reads the resolved table back, and audits the signed text', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const signature = await admin.sign({ action: 'setting_update', key: 'free_on_signup', value: 7 });
    const dto = await handlerOf(ctx).execute(new UpdateSettingCommand(admin.wallet, 'free_on_signup', 7, 'req-1', signature));
    expect(dto).toMatchObject({ key: 'free_on_signup', value: 7, settings: { freeOnSignup: 7, freeRidesDailyMax: 5 } });
    const [row] = ctx.db.adminActions;
    expect(row).toMatchObject({ wallet: admin.wallet, action: 'setting.update', target: 'free_on_signup', detail: { value: 7, signed: { signature } }, requestId: 'req-1', at: ctx.now() });
    expect((row?.detail['signed'] as { message: string }).message).toContain('Action: SET setting free_on_signup');
  });

  it('an unknown key or an out-of-range value is a 400 before the signature is spent, and nothing is stored', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const run = (key: string, value: number) => handlerOf(ctx).execute(new UpdateSettingCommand(admin.wallet, key, value, null, 'sig'));
    await expect(run('nope', 1)).rejects.toBeInstanceOf(BadRequestError);
    await expect(run('free_on_signup', 100_001)).rejects.toMatchObject({ errorCode: 'bad_setting' });
    expect(ctx.db.adminActions).toEqual([]);
    expect(await ctx.settingsRepo.all()).toEqual([]);
    expect(ctx.db.challenges.size).toBe(0);
  });
});
