import { SetConvoyPrivacyCommand } from '../../../../src/application/referral/convoy.command.js';
import { convoyPrivacyBodySchema } from '../../../../src/presentation/referral/dto/convoy.dto.js';
import { PrivacyHttpController } from '../../../../src/presentation/referral/privacy.http.controller.js';
import { busMock } from '../../../support/bus.js';

describe('PrivacyHttpController', () => {
  it('toggles convoyHidden for the signed-in wallet', async () => {
    const commands = busMock({});
    const controller = new PrivacyHttpController(commands.bus);
    await controller.privacy({ wallet: 'ada' }, convoyPrivacyBodySchema.parse({ convoyHidden: true }));
    expect(commands.last()).toEqual(new SetConvoyPrivacyCommand('ada', true));
    expect(convoyPrivacyBodySchema.safeParse({ convoyHidden: true, extra: 1 }).success).toBe(false);
  });
});
