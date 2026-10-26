import { HeliusFundingEvidenceAdapter } from '../../../../src/infrastructure/trust/helius-funding-evidence.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
const wallet = 'So11111111111111111111111111111111111111112', signature = '1'.repeat(88);
const fact = { funder: wallet, funderType: 'exchange', amountRaw: '100000000000000001', signature, slot: 123, timestamp: 1234 };
describe('HeliusFundingEvidenceAdapter', () => {
  const make = (key: string | null = 'fixture-helius') => new HeliusFundingEvidenceAdapter({ heliusApiKey: key } as EnvService);
  afterEach(() => vi.unstubAllGlobals());
  it('preserves exact lamports and labels exchange funding excluded, without an ownership inference', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(fact))); vi.stubGlobal('fetch', fetcher);
    expect(await make().lookup(wallet)).toMatchObject({ status: 'observed', excluded: 'exchange', funder: { wallet, amountRaw: fact.amountRaw, at: 1234000 } });
    expect(fetcher).toHaveBeenCalledWith(`https://api.helius.xyz/v1/wallet/${wallet}/funded-by`, expect.objectContaining({ headers: { 'X-Api-Key': 'fixture-helius' }, redirect: 'error' }));
  });
  it('404 falls back to one bounded transfer page and reports incomplete without inventing a first funder', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ counterparty: wallet, direction: 'in', mint: wallet, amountRaw: '2', signature, timestamp: 1 }], pagination: { hasMore: true, nextCursor: 'next' } })));
    vi.stubGlobal('fetch', fetcher);
    expect(await make().lookup(wallet)).toMatchObject({ status: 'incomplete', funder: null, complete: false, transfers: [{ amountRaw: '2' }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('missing credentials,403,provider failure and malformed evidence never imply suspicious activity', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('', { status: 404 })).mockRejectedValueOnce(new Error('private error'));
    vi.stubGlobal('fetch', fetcher);
    expect((await make(null).lookup(wallet)).status).toBe('unconfigured');
    expect((await make().lookup('bad')).status).toBe('invalid_input');
    for (let i = 0; i < 3; i++) expect((await make().lookup(wallet)).status).toBe('unavailable');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('404 and an empty complete history is not_found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ data: [], pagination: { hasMore: false } }))));
    expect(await make().lookup(wallet)).toMatchObject({ status: 'not_found', funder: null, complete: true, transfers: [] });
  });
});
