import { TelegramBotAdapter, telegramGetChatMember, telegramMemberStatus } from '../../../../src/infrastructure/social/telegram-bot.adapter.js';

describe('TelegramBotAdapter', () => {
  it('does not call the network without a token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new TelegramBotAdapter().getChatMember({ telegramUserId: '1', chatId: '@FreightChain' })).rejects.toMatchObject({ errorCode: 'telegram_unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('parses getChatMember from an injected fetch and a dummy token', async () => {
    const fetchImpl = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ ok: true, result: { status: 'member' } }) }));
    await expect(telegramGetChatMember('dummy-token', '@FreightChain', '42', fetchImpl)).resolves.toEqual({ status: 'member' });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('https://api.telegram.org/bot');
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('twitterapi.io');
    expect(telegramMemberStatus({ ok: false })).toBeNull();
  });
});
