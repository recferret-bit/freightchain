import { PublicKey, Keypair } from '@solana/web3.js';
import { SgtOwnershipAdapter } from '../../../../src/infrastructure/solana/sgt-ownership.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { sgtFixture, sgtRpc } from '../../../support/sgt-fixture.js';

const adapter = (url: string | undefined = 'https://rpc.test/secret-key') => new SgtOwnershipAdapter({ sgtRpcUrl: url } as EnvService);
afterEach(() => vi.unstubAllGlobals());
describe('SGT finalized mainnet ownership proof', () => {
  it('checks canonical extensions and accepts the genuine frozen positive account; rechecks account and mint together', async () => {
    const f = sgtFixture(), fetcher = sgtRpc(f); vi.stubGlobal('fetch', fetcher);
    expect(await adapter().verify(f.wallet.toBase58())).toEqual([{ mint: f.mint.toBase58(), slot: 101 }]);
    const calls = fetcher.mock.calls.map(c => JSON.parse(String(c[1]?.body)));
    expect(calls.map(c => c.method)).toEqual(['getGenesisHash', 'getTokenAccountsByOwner', 'getMultipleAccounts']);
    expect(calls[1].params[0]).toBe(f.wallet.toBase58());
    expect(calls[2].params).toEqual([[f.account.toBase58(), f.mint.toBase58()], { encoding: 'base64', commitment: 'finalized', minContextSlot: 100 }]);
  });
  it.each(['empty', 'owner', 'mint', 'metadata', 'group', 'memberMint', 'supply', 'decimals', 'uninitialized'])('refuses forged or stale %s evidence', async kind => {
    const f = sgtFixture();
    if (kind === 'empty') f.token.writeBigUInt64LE(0n, 64);
    if (kind === 'owner') Keypair.generate().publicKey.toBuffer().copy(f.token, 32);
    if (kind === 'mint') Keypair.generate().publicKey.toBuffer().copy(f.token);
    if (kind === 'metadata') PublicKey.default.toBuffer().copy(f.pointer, 32);
    if (kind === 'group') PublicKey.default.toBuffer().copy(f.member, 32);
    if (kind === 'memberMint') PublicKey.default.toBuffer().copy(f.member);
    if (kind === 'supply') f.base.writeBigUInt64LE(2n, 36);
    if (kind === 'decimals') f.base[44] = 9;
    if (kind === 'uninitialized') f.token[108] = 0;
    vi.stubGlobal('fetch', sgtRpc(f));
    expect(await adapter().verify(f.wallet.toBase58())).toEqual([]);
  });
  it('refuses a transfer between discovery and snapshot', async () => {
    const f = sgtFixture(), discovery = { context: { slot: 100 }, value: [{ pubkey: f.account.toBase58(), account: f.tokenData() }] };
    f.token.writeBigUInt64LE(0n, 64); vi.stubGlobal('fetch', sgtRpc(f, { discovery }));
    expect(await adapter().verify(f.wallet.toBase58())).toEqual([]);
  });
  it.each([{ genesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1' }, { snapshot: { context: { slot: 99 }, value: [] } }, { discovery: { value: [] } }])('fails closed on wrong cluster/stale/incomplete provider response', async options => {
    const f = sgtFixture(); vi.stubGlobal('fetch', sgtRpc(f, options));
    await expect(adapter().verify(f.wallet.toBase58())).rejects.toMatchObject({ errorCode: 'sgt_unavailable' });
  });
  it('distinguishes unconfigured and outage without leaking the RPC key', async () => {
    await expect(new SgtOwnershipAdapter({} as EnvService).verify('x')).rejects.toMatchObject({ errorCode: 'sgt_unconfigured' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-key')));
    await expect(adapter().verify(Keypair.generate().publicKey.toBase58())).rejects.toMatchObject({ message: 'Seeker ownership verification is temporarily unavailable', errorCode: 'sgt_unavailable' });
  });
});
