import { ClaimAirdropCommand, GetAirdropStatusQuery, VerifyTelegramCommand, VerifyXCommand } from '../../../../src/application/airdrop/airdrop.command.js';
import { ClaimAirdropHandler, GetAirdropStatusHandler, VerifyTelegramHandler, VerifyXHandler } from '../../../../src/application/airdrop/airdrop.handler.js';
import type { AirdropService } from '../../../../src/application/airdrop/airdrop.service.js';

describe('airdrop handlers', () => {
  it('dispatches status, telegram, x, and claim to the service', async () => {
    const airdrop = {
      status: vi.fn(async () => ({ claimed: false })),
      verifyTelegram: vi.fn(async () => ({ claimed: false })),
      verifyX: vi.fn(async () => ({ claimed: false })),
      claim: vi.fn(async () => ({ claimed: true })),
    };
    const svc = airdrop as unknown as AirdropService;
    await new GetAirdropStatusHandler(svc).execute(new GetAirdropStatusQuery('ada'));
    await new VerifyTelegramHandler(svc).execute(new VerifyTelegramCommand('ada', '100', 'tok'));
    await new VerifyXHandler(svc).execute(new VerifyXCommand('ada', 'ada', '55', 'tok'));
    await new ClaimAirdropHandler(svc).execute(new ClaimAirdropCommand('ada', 'tok'));
    expect(airdrop.status).toHaveBeenCalledWith('ada');
    expect(airdrop.verifyTelegram).toHaveBeenCalledWith('ada', '100', 'tok');
    expect(airdrop.verifyX).toHaveBeenCalledWith('ada', 'ada', '55', 'tok');
    expect(airdrop.claim).toHaveBeenCalledWith('ada', 'tok');
  });
});
