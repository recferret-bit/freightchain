import { IpinfoEvidenceAdapter } from '../../../../src/infrastructure/trust/ipinfo-evidence.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
const row = { ip: '8.8.8.8', geo: { city: 'not retained' }, as: { asn: 'AS15169' }, is_mobile: false, is_hosting: true, is_anonymous: false };
describe('IpinfoEvidenceAdapter', () => {
  const make = (key: string | null = 'fixture-ipinfo') => new IpinfoEvidenceAdapter({ ipinfoToken: key } as EnvService);
  afterEach(() => vi.unstubAllGlobals());
  it('does not send missing credentials or private/invalid addresses to a provider', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await make(null).lookup('8.8.8.8')).status).toBe('unconfigured');
    for (const ip of [null, 'bad', '127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', 'fc00::1', '::ffff:127.0.0.1', 'fe80::1%en0']) expect((await make().lookup(ip)).status, ip ?? 'null').toBe('invalid_input');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps only network facts and excludes mobile networks from cluster evidence', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...row, is_mobile: true }))); vi.stubGlobal('fetch', fetcher);
    expect(await make().lookup('8.8.8.8')).toEqual({ status: 'observed', asn: 'AS15169', mobile: true, hosting: true, anonymous: false, excluded: 'mobile' });
    expect(fetcher).toHaveBeenCalledWith('https://api.ipinfo.io/lookup/8.8.8.8', expect.objectContaining({ redirect: 'error', headers: { Authorization: 'Bearer fixture-ipinfo' } }));
  });
  it('treats a lower-plan/malformed response, rate limit and failure as unavailable, without retries', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ as: row.as }))).mockResolvedValueOnce(new Response('', { status: 429 })).mockRejectedValueOnce(new Error('private provider detail'));
    vi.stubGlobal('fetch', fetcher);
    for (let i = 0; i < 3; i++) expect((await make().lookup('8.8.8.8')).status).toBe('unavailable');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
