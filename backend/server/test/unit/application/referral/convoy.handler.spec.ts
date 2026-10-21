import { ReferralRepositoryPort } from '../../../../src/application/ports/referral/referral.repository.port.js';
import { BindConvoyCommand, GetConvoyLeaderboardQuery, SetConvoyPrivacyCommand } from '../../../../src/application/referral/convoy.command.js';
import { BindConvoyHandler, GetConvoyLeaderboardHandler, SetConvoyPrivacyHandler } from '../../../../src/application/referral/convoy.handler.js';
import type { ConvoyService } from '../../../../src/application/referral/convoy.service.js';

describe('convoy handlers', () => {
  it('resolves an invite code and dispatches bind, leaderboard, and privacy', async () => {
    const convoy = { bind: vi.fn(async () => ({ status: 'pending' })), leaderboard: vi.fn(async () => ({ rows: [] })), setPrivacy: vi.fn(async () => ({ column: 'missing' })) };
    const referrals = { codeByCode: async (code: string) => code === 'ABCD2345' ? { wallet: 'referrer', code, gift: 'convoy', createdAt: new Date(0) } : null } as unknown as ReferralRepositoryPort;
    const bind = new BindConvoyHandler(convoy as unknown as ConvoyService, referrals);
    await bind.execute(new BindConvoyCommand('referee', 'ABCD2345'));
    expect(convoy.bind).toHaveBeenCalledWith('referee', 'referrer');
    await expect(bind.execute(new BindConvoyCommand('referee', 'SHORT'))).rejects.toMatchObject({ errorCode: 'bad_code' });
    await expect(bind.execute(new BindConvoyCommand('referee', 'ZZZZZZZZ'))).rejects.toMatchObject({ errorCode: 'unknown_code' });
    await new GetConvoyLeaderboardHandler(convoy as unknown as ConvoyService).execute(new GetConvoyLeaderboardQuery('referee'));
    expect(convoy.leaderboard).toHaveBeenCalledWith('referee');
    await new SetConvoyPrivacyHandler(convoy as unknown as ConvoyService).execute(new SetConvoyPrivacyCommand('referee', true));
    expect(convoy.setPrivacy).toHaveBeenCalledWith('referee', true);
  });
});
