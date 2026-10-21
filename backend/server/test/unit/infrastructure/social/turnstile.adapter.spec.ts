import { TurnstileAdapter, turnstileSuccess, verifyTurnstile } from '../../../../src/infrastructure/social/turnstile.adapter.js';

describe('TurnstileAdapter', () => {
  it('does not fetch when no secret is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new TurnstileAdapter().verify('token')).rejects.toMatchObject({ errorCode: 'turnstile_unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('posts siteverify with a dummy secret and a fake response', async () => {
    const fetchImpl = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ success: true }) }));
    await expect(verifyTurnstile('not-a-real-secret', 'tok', fetchImpl)).resolves.toBe(true);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(turnstileSuccess({ success: false })).toBe(false);
    await expect(verifyTurnstile(null, 'tok', fetchImpl)).rejects.toMatchObject({ errorCode: 'turnstile_unconfigured' });
  });
});
