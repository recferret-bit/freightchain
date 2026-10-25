import { TwitterApiIoAdapter } from '../../../../src/infrastructure/social/twitterapi-io.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
const env = { twitterApiIoKey: 'dummy-key' } as EnvService;
const profile = { status: 'success', data: { id: '42', userName: 'ada', createdAt: '2020-01-01T00:00:00Z', followers: 10 } };
const reply = (body: unknown) => ({ ok: true, json: async () => body });
afterEach(() => vi.unstubAllGlobals());
describe('TwitterApiIoAdapter', () => {
  it('does not contact X without configuration', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const adapter = new TwitterApiIoAdapter({} as EnvService);
    await expect(adapter.lookup('ada')).rejects.toMatchObject({ errorCode: 'x_verifier_unconfigured' });
    await expect(adapter.quote('55')).rejects.toMatchObject({ errorCode: 'x_verifier_unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('reads account, official follow relationship and the exact requested post author', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(profile)).mockResolvedValueOnce(reply({ status: 'success', data: { following: true } })).mockResolvedValueOnce(reply({ status: 'success', tweets: [{ id: '55', text: 'hello', author: { id: '42' } }] })); vi.stubGlobal('fetch', fetchMock);
    const adapter = new TwitterApiIoAdapter(env);
    expect(await adapter.lookup('ada')).toEqual({ userId: '42', handle: 'ada', createdAt: new Date('2020-01-01'), followers: 10, followsOfficial: true });
    expect(await adapter.quote('55')).toEqual({ userId: '42', text: 'hello' });
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['https://api.twitterapi.io/twitter/user/info?userName=ada', 'https://api.twitterapi.io/twitter/user/check_follow_relationship?source_user_name=ada&target_user_name=FreightChainSol', 'https://api.twitterapi.io/twitter/tweets?tweet_ids=55']);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { 'X-API-Key': 'dummy-key' }, redirect: 'error' });
  });
  it.each([{ status: 'error' }, { ...profile, data: { ...profile.data, userName: 'someoneElse' } }, { ...profile, data: { ...profile.data, createdAt: 'invalid' } }])('rejects malformed or mismatched account data (%j)', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(body)));
    await expect(new TwitterApiIoAdapter(env).lookup('ada')).rejects.toMatchObject({ errorCode: 'x_verifier_unavailable' });
  });
  it('returns no post for an unrelated ID or empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ status: 'success', tweets: [{ id: '99', text: 'wrong', author: { id: '42' } }] })));
    expect(await new TwitterApiIoAdapter(env).quote('55')).toBeNull();
  });
  it('sanitizes network and authorization errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('dummy-key'); }));
    await expect(new TwitterApiIoAdapter(env).lookup('ada')).rejects.toMatchObject({ errorCode: 'x_verifier_unavailable', message: 'social verification provider unavailable' });
  });
});
