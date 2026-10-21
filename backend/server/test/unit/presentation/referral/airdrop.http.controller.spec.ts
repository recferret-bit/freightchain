import { ClaimAirdropCommand, GetAirdropStatusQuery, VerifyTelegramCommand, VerifyXCommand } from '../../../../src/application/airdrop/airdrop.command.js';
import { claimAirdropBodySchema, verifyTelegramBodySchema, verifyXBodySchema } from '../../../../src/presentation/referral/dto/airdrop.dto.js';
import { AirdropHttpController } from '../../../../src/presentation/referral/airdrop.http.controller.js';
import { busMock } from '../../../support/bus.js';

describe('AirdropHttpController', () => {
  it('dispatches status, telegram, x, and claim for the signed-in wallet', async () => {
    const commands = busMock({}), queries = busMock({});
    const controller = new AirdropHttpController(commands.bus, queries.bus);
    await controller.status({ wallet: 'ada' });
    expect(queries.last()).toEqual(new GetAirdropStatusQuery('ada'));
    await controller.verifyTelegram({ wallet: 'ada' }, verifyTelegramBodySchema.parse({ telegramUserId: '100' }));
    expect(commands.last()).toEqual(new VerifyTelegramCommand('ada', '100', undefined));
    await controller.verifyX({ wallet: 'ada' }, verifyXBodySchema.parse({ handle: 'ada', postId: '55' }));
    expect(commands.last()).toEqual(new VerifyXCommand('ada', 'ada', '55', undefined));
    await controller.claim({ wallet: 'ada' }, claimAirdropBodySchema.parse({}));
    expect(commands.last()).toEqual(new ClaimAirdropCommand('ada', undefined));
    expect(verifyTelegramBodySchema.safeParse({ telegramUserId: 'nope' }).success).toBe(false);
    expect(claimAirdropBodySchema.safeParse({ turnstileToken: 't', extra: true }).success).toBe(false);
  });
});
