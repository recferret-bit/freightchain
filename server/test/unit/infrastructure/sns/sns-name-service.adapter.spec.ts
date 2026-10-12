import { AccountInfo, Keypair, PublicKey } from '@solana/web3.js';
import { SnsNameServiceAdapter, getDomainKey, getFavoriteKey, getReverseKey } from '../../../../src/infrastructure/sns/sns-name-service.adapter.js';
import { MemoryCacheAdapter } from '../../../../src/infrastructure/cache/memory-cache.adapter.js';
import { FakeClock } from '../../../support/fake-clock.js';
import { SolanaRpc } from '../../../../src/infrastructure/solana/solana-rpc.js';
import { EnvService } from '../../../../src/infrastructure/config/env.service.js';

class MockSolanaRpc extends SolanaRpc {
  readCalls = 0;
  mockAccounts = new Map<string, AccountInfo<Buffer> | null>();
  failWith: Error | null = null;
  delayMs = 0;

  constructor() {
    super({} as any, []);
  }

  override async read<T>(call: (conn: any) => Promise<T>): Promise<T> {
    this.readCalls++;
    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }
    if (this.failWith) {
      throw this.failWith;
    }
    const fakeConn = {
      getAccountInfo: async (key: PublicKey) => {
        return this.mockAccounts.get(key.toBase58()) ?? null;
      },
      getMultipleAccountsInfo: async (keys: PublicKey[]) => {
        return keys.map((k) => this.mockAccounts.get(k.toBase58()) ?? null);
      },
    };
    return call(fakeConn);
  }
}

function makeEnv(overrides: Partial<EnvService> = {}): EnvService {
  return {
    snsRpc: 'https://api.mainnet-beta.solana.com',
    snsRpcFallbacks: [],
    snsCacheTtlSeconds: 86400,
    snsNegativeCacheTtlSeconds: 1800,
    ...overrides,
  } as unknown as EnvService;
}

function makeAccountInfo(data: Buffer): AccountInfo<Buffer> {
  return {
    data,
    executable: false,
    lamports: 1000000,
    owner: new PublicKey('namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX'),
  };
}

function makeFavoriteAccount(nameAccount: PublicKey): AccountInfo<Buffer> {
  const buf = Buffer.alloc(33);
  buf.writeUInt8(4, 0);
  nameAccount.toBuffer().copy(buf, 1);
  return makeAccountInfo(buf);
}

function makeDomainAccount(owner: PublicKey): AccountInfo<Buffer> {
  const buf = Buffer.alloc(96);
  owner.toBuffer().copy(buf, 32);
  return makeAccountInfo(buf);
}

function makeReverseAccount(domainName: string): AccountInfo<Buffer> {
  const clean = domainName.replace(/\.(sol|sns)$/, '');
  const strBuf = Buffer.from(clean, 'utf8');
  const buf = Buffer.alloc(100 + strBuf.length);
  buf.writeUInt32LE(strBuf.length, 96);
  strBuf.copy(buf, 100);
  return makeAccountInfo(buf);
}

describe('SnsNameServiceAdapter', () => {
  let clock: FakeClock;
  let cache: MemoryCacheAdapter;
  let rpc: MockSolanaRpc;
  let env: EnvService;
  let adapter: SnsNameServiceAdapter;

  beforeEach(() => {
    clock = new FakeClock();
    cache = new MemoryCacheAdapter(clock);
    rpc = new MockSolanaRpc();
    env = makeEnv();
    adapter = new SnsNameServiceAdapter(env, cache, rpc);
  });

  describe('forward resolution (resolve)', () => {
    it('resolves valid .sol domain to wallet owner address', async () => {
      const owner = Keypair.generate().publicKey;
      const domainKey = getDomainKey('bonfida');
      rpc.mockAccounts.set(domainKey.toBase58(), makeDomainAccount(owner));

      const result = await adapter.resolve('bonfida.sol');
      expect(result).toBe(owner.toBase58());
      expect(rpc.readCalls).toBe(1);
    });

    it('normalizes domain input (whitespace, uppercase, .sol/.sns suffix)', async () => {
      const owner = Keypair.generate().publicKey;
      const domainKey = getDomainKey('alice');
      rpc.mockAccounts.set(domainKey.toBase58(), makeDomainAccount(owner));

      expect(await adapter.resolve('  ALICE.SOL  ')).toBe(owner.toBase58());
      expect(await adapter.resolve('alice.sns')).toBe(owner.toBase58());
      expect(await adapter.resolve('alice')).toBe(owner.toBase58());
    });

    it('returns null on non-existent domain account and caches negatively', async () => {
      const res = await adapter.resolve('nonexistent.sol');
      expect(res).toBeNull();
      expect(rpc.readCalls).toBe(1);

      // Second call should be answered from negative cache
      const cached = await adapter.resolve('nonexistent.sol');
      expect(cached).toBeNull();
      expect(rpc.readCalls).toBe(1);
    });

    it('returns null on malformed account data (< 64 bytes)', async () => {
      const domainKey = getDomainKey('corrupt');
      rpc.mockAccounts.set(domainKey.toBase58(), makeAccountInfo(Buffer.alloc(32)));

      const res = await adapter.resolve('corrupt.sol');
      expect(res).toBeNull();
    });

    it('returns null on invalid domain characters or empty input without calling RPC', async () => {
      expect(await adapter.resolve('')).toBeNull();
      expect(await adapter.resolve('bad name.sol')).toBeNull();
      expect(await adapter.resolve('bad/name.sol')).toBeNull();
      expect(rpc.readCalls).toBe(0);
    });
  });

  describe('reverse resolution (reverse / reverseLookup)', () => {
    it('resolves wallet to primary domain when favorite + reverse accounts exist', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount('driver'));

      const domain = await adapter.reverse(wallet.toBase58());
      expect(domain).toBe('driver.sol');
      expect(await adapter.reverseLookup(wallet.toBase58())).toBe('driver.sol');
    });

    it('detects STALENESS: returns null when domain owner does not match wallet', async () => {
      const wallet = Keypair.generate().publicKey;
      const otherOwner = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      // Stale record: domain account is owned by otherOwner now!
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(otherOwner));
      rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount('stale-name'));

      const domain = await adapter.reverse(wallet.toBase58());
      expect(domain).toBeNull();
    });

    it('returns null when wallet has no favorite domain and caches negatively', async () => {
      const wallet = Keypair.generate().publicKey.toBase58();
      const domain = await adapter.reverse(wallet);
      expect(domain).toBeNull();
      expect(rpc.readCalls).toBe(1);

      // Hit negative cache
      const cached = await adapter.reverse(wallet);
      expect(cached).toBeNull();
      expect(rpc.readCalls).toBe(1);
    });

    it('returns null on invalid base58 wallet address without calling RPC', async () => {
      expect(await adapter.reverse('not-a-valid-wallet')).toBeNull();
      expect(await adapter.reverse('')).toBeNull();
      expect(rpc.readCalls).toBe(0);
    });

    it('returns null when favorite account data < 33 bytes or reverse data < 100 bytes', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      rpc.mockAccounts.set(favKey.toBase58(), makeAccountInfo(Buffer.alloc(20)));

      expect(await adapter.reverse(wallet.toBase58())).toBeNull();
    });
  });

  describe('caching and TTL expiration', () => {
    it('caches positive hits for 24 hours and expires properly with FakeClock', async () => {
      const owner = Keypair.generate().publicKey;
      const domainKey = getDomainKey('cached-test');
      rpc.mockAccounts.set(domainKey.toBase58(), makeDomainAccount(owner));

      const first = await adapter.resolve('cached-test.sol');
      expect(first).toBe(owner.toBase58());
      expect(rpc.readCalls).toBe(1);

      // Advance clock by 23 hours (82,800s) -> still cached
      clock.advance(82800);
      const second = await adapter.resolve('cached-test.sol');
      expect(second).toBe(owner.toBase58());
      expect(rpc.readCalls).toBe(1);

      // Advance past 24 hours total (e.g. +3,601s -> 86,401s) -> expires
      clock.advance(3601);
      const third = await adapter.resolve('cached-test.sol');
      expect(third).toBe(owner.toBase58());
      expect(rpc.readCalls).toBe(2);
    });

    it('caches negative hits for 30 minutes and expires properly with FakeClock', async () => {
      const wallet = Keypair.generate().publicKey.toBase58();
      expect(await adapter.reverse(wallet)).toBeNull();
      expect(rpc.readCalls).toBe(1);

      // Advance clock by 29 minutes (1,740s) -> still cached negative
      clock.advance(1740);
      expect(await adapter.reverse(wallet)).toBeNull();
      expect(rpc.readCalls).toBe(1);

      // Advance past 30 minutes (+61s -> 1,801s) -> negative cache expires
      clock.advance(61);
      expect(await adapter.reverse(wallet)).toBeNull();
      expect(rpc.readCalls).toBe(2);
    });
  });

  describe('error handling and resilience', () => {
    it('silently returns null when RPC throws an error', async () => {
      rpc.failWith = new Error('RPC connection refused');
      const res = await adapter.resolve('error-test.sol');
      expect(res).toBeNull();
    });

    it('does NOT write negative cache on transient RPC errors', async () => {
      rpc.failWith = new Error('Network timeout');
      await adapter.resolve('transient.sol');
      expect(rpc.readCalls).toBe(1);

      // Recovery: RPC recovers
      rpc.failWith = null;
      const owner = Keypair.generate().publicKey;
      const domainKey = getDomainKey('transient');
      rpc.mockAccounts.set(domainKey.toBase58(), makeDomainAccount(owner));

      const res = await adapter.resolve('transient.sol');
      expect(res).toBe(owner.toBase58());
      expect(rpc.readCalls).toBe(2);
    });
  });

  describe('request coalescing', () => {
    it('coalesces concurrent reverse calls for the same wallet into 1 RPC invocation', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount('coalesce'));

      // Launch 3 simultaneous calls
      const [r1, r2, r3] = await Promise.all([
        adapter.reverse(wallet.toBase58()),
        adapter.reverse(wallet.toBase58()),
        adapter.reverse(wallet.toBase58()),
      ]);

      expect(r1).toBe('coalesce.sol');
      expect(r2).toBe('coalesce.sol');
      expect(r3).toBe('coalesce.sol');
      // Coalesced into 1 RPC flow (2 read calls: getAccountInfo + getMultipleAccountsInfo)
      expect(rpc.readCalls).toBe(2);
    });
  });

  describe('batch reverse resolution (reverseBatch)', () => {
    it('resolves a batch of wallets with mixed hits, misses, and stale records', async () => {
      const w1 = Keypair.generate().publicKey;
      const w2 = Keypair.generate().publicKey;
      const wStale = Keypair.generate().publicKey;
      const wMissing = Keypair.generate().publicKey;

      // w1 has favorite + domain + reverse
      const name1 = Keypair.generate().publicKey;
      rpc.mockAccounts.set(getFavoriteKey(w1).toBase58(), makeFavoriteAccount(name1));
      rpc.mockAccounts.set(name1.toBase58(), makeDomainAccount(w1));
      rpc.mockAccounts.set(getReverseKey(name1).toBase58(), makeReverseAccount('driver-one'));

      // w2 has favorite + domain + reverse
      const name2 = Keypair.generate().publicKey;
      rpc.mockAccounts.set(getFavoriteKey(w2).toBase58(), makeFavoriteAccount(name2));
      rpc.mockAccounts.set(name2.toBase58(), makeDomainAccount(w2));
      rpc.mockAccounts.set(getReverseKey(name2).toBase58(), makeReverseAccount('driver-two'));

      // wStale points to domain owned by someone else
      const nameStale = Keypair.generate().publicKey;
      rpc.mockAccounts.set(getFavoriteKey(wStale).toBase58(), makeFavoriteAccount(nameStale));
      rpc.mockAccounts.set(nameStale.toBase58(), makeDomainAccount(Keypair.generate().publicKey)); // different owner
      rpc.mockAccounts.set(getReverseKey(nameStale).toBase58(), makeReverseAccount('stale-domain'));

      // wMissing has no favorite record

      const batch = await adapter.reverseBatch([
        w1.toBase58(),
        w2.toBase58(),
        wStale.toBase58(),
        wMissing.toBase58(),
        'invalid-wallet',
      ]);

      expect(batch.get(w1.toBase58())).toBe('driver-one.sol');
      expect(batch.get(w2.toBase58())).toBe('driver-two.sol');
      expect(batch.get(wStale.toBase58())).toBeNull();
      expect(batch.get(wMissing.toBase58())).toBeNull();
      expect(batch.get('invalid-wallet')).toBeNull();

      // Subsequent batch uses cache and makes 0 RPC calls
      const callsBefore = rpc.readCalls;
      const cachedBatch = await adapter.reverseLookupBatch([w1.toBase58(), w2.toBase58(), wMissing.toBase58()]);
      expect(cachedBatch.get(w1.toBase58())).toBe('driver-one.sol');
      expect(cachedBatch.get(w2.toBase58())).toBe('driver-two.sol');
      expect(cachedBatch.get(wMissing.toBase58())).toBeNull();
      expect(rpc.readCalls).toBe(callsBefore);
    });

    it('gracefully handles empty input and RPC errors in batch', async () => {
      expect((await adapter.reverseBatch([])).size).toBe(0);

      rpc.failWith = new Error('RPC failure');
      const w = Keypair.generate().publicKey.toBase58();
      const res = await adapter.reverseBatch([w]);
      expect(res.get(w)).toBeNull();
    });
  });
});
