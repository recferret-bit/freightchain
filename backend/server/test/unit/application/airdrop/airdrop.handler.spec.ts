import { ClaimPreseasonAttemptCommand, ClaimAirdropCommand, GetAirdropStatusQuery, VerifyTelegramCommand, VerifyXCommand } from '../../../../src/application/airdrop/airdrop.command.js';
import { ClaimPreseasonAttemptHandler, ClaimAirdropHandler, GetAirdropStatusHandler, VerifyTelegramHandler, VerifyXHandler } from '../../../../src/application/airdrop/airdrop.handler.js';
import type { ConvoyService } from '../../../../src/application/referral/convoy.service.js';
import type { AirdropService } from '../../../../src/application/airdrop/airdrop.service.js';

describe('airdrop handlers', () => {
  it('dispatches status, telegram, x, and claim to the service', async () => {
    const airdrop = {
      status: vi.fn(async () => ({ claimed: false })),
      verifyTelegram: vi.fn(async () => ({ claimed: false })),
      verifyX: vi.fn(async () => ({ claimed: false })),
      claimAttempt: vi.fn(async () => ({ claimed: false })),
      claim: vi.fn(async () => ({ claimed: true })),
    };
    const convoy = { refreshMilestones: vi.fn(async () => undefined) };
    const progress = convoy as unknown as ConvoyService;
    const svc = airdrop as unknown as AirdropService;
    await new GetAirdropStatusHandler(svc).execute(new GetAirdropStatusQuery('ada'));
    await new VerifyTelegramHandler(svc, progress).execute(new VerifyTelegramCommand('ada', '100', 'tok'));
    await new VerifyXHandler(svc, progress).execute(new VerifyXCommand('ada', 'ada', '55', 'tok'));
    await new ClaimAirdropHandler(svc).execute(new ClaimAirdropCommand('ada', 'tok'));
    await new ClaimPreseasonAttemptHandler(svc).execute(new ClaimPreseasonAttemptCommand('ada', true, 'tok'));
    expect(airdrop.claimAttempt).toHaveBeenCalledWith('ada', true, 'tok');
    expect(airdrop.status).toHaveBeenCalledWith('ada');
    expect(airdrop.verifyTelegram).toHaveBeenCalledWith('ada', '100', 'tok', undefined);
    expect(airdrop.verifyX).toHaveBeenCalledWith('ada', 'ada', '55', 'tok');
    expect(convoy.refreshMilestones).toHaveBeenCalledTimes(2);
    expect(convoy.refreshMilestones).toHaveBeenCalledWith('ada');
    expect(airdrop.claim).toHaveBeenCalledWith('ada', 'tok');
  });
});
