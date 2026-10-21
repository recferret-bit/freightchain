import { readFileSync } from 'node:fs';
import { TwitterApiIoAdapter } from '../../../../src/infrastructure/social/twitterapi-io.adapter.js';

describe('TwitterApiIoAdapter', () => {
  it('does not call fetch or twitterapi.io', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new TwitterApiIoAdapter();
    await expect(adapter.lookup('ada')).rejects.toMatchObject({ errorCode: 'x_verifier_unconfigured' });
    await expect(adapter.quote('55')).rejects.toMatchObject({ errorCode: 'x_verifier_unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
    const source = readFileSync(new URL('../../../../src/infrastructure/social/twitterapi-io.adapter.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('twitterapi.io');
    vi.unstubAllGlobals();
  });
});
