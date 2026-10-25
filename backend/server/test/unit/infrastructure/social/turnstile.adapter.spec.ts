import { TurnstileAdapter, verifyTurnstile } from '../../../../src/infrastructure/social/turnstile.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
const env = (extra = {}) => ({ appOrigin: 'https://freightchain.example', ...extra }) as EnvService;
afterEach(() => vi.unstubAllGlobals());
describe('TurnstileAdapter', () => {
  it('does not fetch without a secret, and social configuration requires verification', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(new TurnstileAdapter(env()).required).toBe(false);
    expect(new TurnstileAdapter(env({ twitterApiIoKey: 'dummy' })).required).toBe(true);
    await expect(new TurnstileAdapter(env()).verify('token')).rejects.toMatchObject({ errorCode: 'turnstile_unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [{ success: true, hostname: 'freightchain.example', action: 'preseason' }, true],
    [{ success: false, hostname: 'freightchain.example', action: 'preseason' }, false],
    [{ success: true, hostname: 'attacker.example', action: 'preseason' }, false],
    [{ success: true, hostname: 'freightchain.example', action: 'login' }, false],
    [{ success: true }, false],
  ])('binds successful challenges to the site and action (%j)', async (body, expected) => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => body })); vi.stubGlobal('fetch', fetchMock);
    expect(await new TurnstileAdapter(env({ turnstileSecretKey: 'dummy' })).verify('tok')).toBe(expected);
    expect(fetchMock).toHaveBeenCalledWith('https://challenges.cloudflare.com/turnstile/v0/siteverify', expect.objectContaining({ method: 'POST', body: 'secret=dummy&response=tok', redirect: 'error' }));
  });
  it('does not accept success in a failed HTTP response', async () => {
    await expect(verifyTurnstile('dummy', 'tok', async () => ({ ok: false, json: async () => ({ success: true }) }))).rejects.toMatchObject({ errorCode: 'turnstile_unavailable' });
  });
});
