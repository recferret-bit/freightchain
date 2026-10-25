import { createHash, createHmac } from 'node:crypto';
import { AirdropService } from '../../src/application/airdrop/airdrop.service.js';
import { EnvService } from '../../src/infrastructure/config/env.service.js';
import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/** Real provider adapters and HTTP/transaction flow; only the external HTTP responses are fixtures. */
export function airdropProviderScenarios(h: () => Harness): void {
  const { login } = bindClient(h);
  it('verifies signed Telegram ownership and wallet-bound X proof, then refuses reuse', async () => {
    const rider = await login(), other = await login();
    const svc = h().app.get(AirdropService), env = h().app.get(EnvService);
    await svc.recordVerifiedRide(rider.address, 'free-2c');
    await svc.recordVerifiedRide(other.address, 'free-2c');
    const token = 'fixture-bot-token', auth_date = Math.floor(h().clock.now().getTime() / 1000);
    const hash = createHmac('sha256', createHash('sha256').update(token).digest()).update(`auth_date=${auth_date}\nfirst_name=Ada\nid=42`).digest('hex');
    const proof = { id: 42, auth_date, first_name: 'Ada', hash };
    const spies = [
      vi.spyOn(env, 'telegramBotToken', 'get').mockReturnValue(token),
      vi.spyOn(env, 'telegramChannelId', 'get').mockReturnValue('@FreightChain'),
      vi.spyOn(env, 'twitterApiIoKey', 'get').mockReturnValue('fixture-x-key'),
      vi.spyOn(env, 'turnstileSecretKey', 'get').mockReturnValue('fixture-turnstile'),
    ];
    const oldRequired = svc.turnstileEnabled;
    svc.turnstileEnabled = true;
    let xCode = `FC-${rider.address}`;
    const fetchMock = vi.fn(async (url: string) => {
      let body: unknown;
      if (url.startsWith('https://challenges.cloudflare.com/')) body = { success: true, hostname: new URL(env.appOrigin).hostname, action: 'preseason' };
      else if (url.startsWith('https://api.telegram.org/')) body = { ok: true, result: { status: 'member' } };
      else if (url.includes('/twitter/user/info?')) body = { status: 'success', data: { id: '84', userName: 'ada', followers: 100, createdAt: '2020-01-01' } };
      else if (url.includes('/twitter/user/check_follow_relationship?')) body = { status: 'success', data: { following: true } };
      else if (url.includes('/twitter/tweets?')) body = { status: 'success', tweets: [{ id: '55', author: { id: '84' }, text: `Joined @FreightChainSol ${xCode}` }] };
      else throw new Error('unexpected provider request');
      return { ok: true, json: async () => body };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const post = (agent: typeof rider.agent, body: object) => agent.post('/api/airdrop/verify-telegram').send({ telegramUserId: '42', turnstileToken: 'fixture', ...body });
      expect((await post(rider.agent, {}).expect(400)).body.code).toBe('telegram_proof_invalid');
      expect(fetchMock.mock.calls.some(([url]) => url.startsWith('https://api.telegram.org/'))).toBe(false);
      expect((await post(rider.agent, { proof }).expect(200)).body.telegram).toEqual({ bound: true, member: true });
      expect((await post(other.agent, { proof }).expect(409)).body.code).toBe('social_account_already_bound');
      const xBody = { handle: 'ada', postId: '55', turnstileToken: 'fixture' };
      expect((await other.agent.post('/api/airdrop/verify-x').send(xBody).expect(400)).body.code).toBe('x_quote_missing');
      expect((await rider.agent.post('/api/airdrop/verify-x').send(xBody).expect(200)).body.x.bound).toBe(true);
      xCode = `FC-${other.address}`;
      expect((await other.agent.post('/api/airdrop/verify-x').send(xBody).expect(409)).body.code).toBe('social_account_already_bound');
      expect((await rider.agent.get('/api/airdrop/status').expect(200)).body).toMatchObject({ code: `FC-${rider.address}`, telegram: { bound: true }, x: { bound: true }, turnstile: { required: true, passed: true } });
    } finally {
      svc.turnstileEnabled = oldRequired;
      for (const spy of spies) spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
}
