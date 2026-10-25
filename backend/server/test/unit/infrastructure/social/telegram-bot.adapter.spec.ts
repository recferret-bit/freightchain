import { createHash, createHmac } from 'node:crypto';
import { TelegramBotAdapter, telegramGetChatMember, telegramMemberStatus, telegramOwnership } from '../../../../src/infrastructure/social/telegram-bot.adapter.js';
import { telegramMember } from '../../../../src/application/airdrop/airdrop-rules.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import type { ClockPort } from '../../../../src/application/ports/shared/clock.port.js';

const now = new Date('2026-10-25T12:00:00Z'), token = 'test-bot-token';
const clock = { now: () => now } as ClockPort;
const auth_date = now.getTime() / 1000;
const hash = createHmac('sha256', createHash('sha256').update(token).digest()).update(`auth_date=${auth_date}\nfirst_name=Ada\nid=42`).digest('hex');
const proof = { id: 42, first_name: 'Ada', auth_date, hash };
const env = (extra = {}) => ({ telegramBotToken: token, telegramChannelId: '@FreightChain', ...extra }) as EnvService;
afterEach(() => vi.unstubAllGlobals());

describe('TelegramBotAdapter', () => {
  it('requires configuration and ownership before contacting Telegram', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(new TelegramBotAdapter(env({ telegramBotToken: undefined }), clock).getChatMember({ telegramUserId: '42', chatId: '' })).rejects.toMatchObject({ errorCode: 'telegram_unconfigured' });
    await expect(new TelegramBotAdapter(env(), clock).getChatMember({ telegramUserId: '42', chatId: '' })).rejects.toMatchObject({ errorCode: 'telegram_proof_invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('verifies the canonical signature, identity and bounded freshness', () => {
    expect(telegramOwnership(token, '42', proof, now)).toBe(true);
    for (const bad of [{ ...proof, first_name: 'Bob' }, { ...proof, hash: '0'.repeat(64) }, { ...proof, auth_date: auth_date - 301 }, { ...proof, auth_date: auth_date + 31 }]) expect(telegramOwnership(token, '42', bad, now)).toBe(false);
    expect(telegramOwnership(token, '43', proof, now)).toBe(false);
    expect(telegramOwnership('wrong-token', '42', proof, now)).toBe(false);
    expect(telegramOwnership(token, '42', proof, new Date(now.getTime() + 301000))).toBe(false);
  });
  it('uses the configured channel and preserves restricted membership facts', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: { status: 'restricted', is_member: false } }) })); vi.stubGlobal('fetch', fetchMock);
    const member = await new TelegramBotAdapter(env(), clock).getChatMember({ telegramUserId: '42', chatId: '@attacker', proof });
    expect(member).toEqual({ status: 'restricted', isMember: false });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('chat_id=%40FreightChain&user_id=42'), expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
    expect(telegramMember(member.status, member.isMember)).toBe(false);
    expect(telegramMember('restricted')).toBe(false);
    expect(telegramMember('restricted', true)).toBe(true);
    expect(telegramMember('member')).toBe(true);
  });
  it('fails closed on provider errors without exposing the token', async () => {
    const fetchMock = vi.fn(async () => { throw new Error(`https://secret/${token}`); });
    await expect(telegramGetChatMember(token, '@FreightChain', '42', fetchMock)).rejects.toMatchObject({ errorCode: 'telegram_unavailable', message: 'social verification provider unavailable' });
    expect(telegramMemberStatus({ ok: false })).toBeNull();
    await expect(telegramGetChatMember(token, '@FreightChain', '42', async () => ({ ok: true, json: async () => ({ ok: false }) }))).rejects.toMatchObject({ errorCode: 'telegram_unavailable' });
  });
});
