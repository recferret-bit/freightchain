import { AccountInfo, Keypair, PublicKey } from '@solana/web3.js';
import {
  SnsNameServiceAdapter,
  getDomainKey,
  getFavoriteKey,
  getReverseKey,
} from '../../../../src/infrastructure/sns/sns-name-service.adapter.js';
import { MemoryCacheAdapter } from '../../../../src/infrastructure/cache/memory-cache.adapter.js';
import { CachePort } from '../../../../src/application/ports/shared/cache.port.js';
import { FakeClock } from '../../../support/fake-clock.js';
import { SolanaRpc } from '../../../../src/infrastructure/solana/solana-rpc.js';
import { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { SnsHttpController } from '../../../../src/presentation/sns/sns.http.controller.js';
import { GetSnsReverseHandler } from '../../../../src/application/use-cases/sns/get-sns-reverse/get-sns-reverse.handler.js';
import { ResolveSnsHandler } from '../../../../src/application/use-cases/sns/resolve-sns/resolve-sns.handler.js';
import { GetLeaderboardHandler } from '../../../../src/application/use-cases/economy/get-leaderboard/get-leaderboard.handler.js';
import { GetLeaderboardQuery } from '../../../../src/application/use-cases/economy/get-leaderboard/get-leaderboard.query.js';
import { GetProfileHandler } from '../../../../src/application/use-cases/lobby/get-profile/get-profile.handler.js';
import { GetProfileQuery } from '../../../../src/application/use-cases/lobby/get-profile/get-profile.query.js';
import { MeProfileService } from '../../../../src/application/services/me-profile.service.js';
import { GetPublicRideHandler } from '../../../../src/application/use-cases/rides/get-public-ride/get-public-ride.handler.js';
import { GetPublicRideQuery } from '../../../../src/application/use-cases/rides/get-public-ride/get-public-ride.query.js';
import { RecordingAnalytics } from '../../../support/recording-analytics.js';
import { unitContext } from '../../../support/unit-context.js';

class EmpiricalMockRpc extends SolanaRpc {
  readCalls = 0;
  batchCalls = 0;
  singleCalls = 0;
  mockAccounts = new Map<string, AccountInfo<Buffer> | null>();
  failWith: Error | null = null;
  delayMs = 0;
  requestedKeyBatches: PublicKey[][] = [];

  constructor() {
    super({} as any, []);
  }

  override async read<T>(call: (conn: any) => Promise<T>): Promise<T> {
    this.readCalls++;
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.failWith) {
      throw this.failWith;
    }
    const fakeConn = {
      getAccountInfo: async (key: PublicKey) => {
        this.singleCalls++;
        return this.mockAccounts.get(key.toBase58()) ?? null;
      },
      getMultipleAccountsInfo: async (keys: PublicKey[]) => {
        if (keys.length > 100) {
          throw new Error(`Solana RPC Limit Exceeded: getMultipleAccountsInfo called with ${keys.length} keys (max allowed: 100)`);
        }
        this.batchCalls++;
        this.requestedKeyBatches.push(keys);
        return keys.map((k) => this.mockAccounts.get(k.toBase58()) ?? null);
      },
    };
    return call(fakeConn);
  }
}

class DelayedAsyncCache extends CachePort {
  readonly kind = 'delayed-async';
  private readonly store = new Map<string, any>();
  constructor(private readonly delayMs: number) {
    super();
  }
  async get<T>(key: string): Promise<T | null> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
  async del(...keys: string[]): Promise<void> {
    for (const k of keys) this.store.delete(k);
  }
}

function makeEnv(overrides: Partial<EnvService> = {}): EnvService {
  return {
    snsRpc: 'https://api.mainnet-beta.solana.com',
    snsRpcFallbacks: ['https://solana-api.projectserum.com'],
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

function seedWalletRecord(
  rpc: EmpiricalMockRpc,
  wallet: PublicKey,
  name: string,
): { nameAccount: PublicKey; reverseKey: PublicKey } {
  const favKey = getFavoriteKey(wallet);
  const nameAccount = Keypair.generate().publicKey;
  const reverseKey = getReverseKey(nameAccount);
  rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
  rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
  rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount(name));
  return { nameAccount, reverseKey };
}

describe('Empirical Challenge: Milestone M2 SNS & Caching', () => {
  let clock: FakeClock;
  let cache: MemoryCacheAdapter;
  let rpc: EmpiricalMockRpc;
  let env: EnvService;
  let adapter: SnsNameServiceAdapter;

  beforeEach(() => {
    clock = new FakeClock();
    cache = new MemoryCacheAdapter(clock);
    rpc = new EmpiricalMockRpc();
    env = makeEnv();
    adapter = new SnsNameServiceAdapter(env, cache, rpc);
  });

  describe('1. Request Coalescing Under High Concurrency', () => {
    it('coalesces 50 concurrent forward lookups for the same uncached domain into 1 RPC call', async () => {
      const owner = Keypair.generate().publicKey;
      const domainKey = getDomainKey('concurrency-test');
      rpc.mockAccounts.set(domainKey.toBase58(), makeDomainAccount(owner));
      rpc.delayMs = 25; // Simulate async network transit

      const promises = Array.from({ length: 50 }, () => adapter.resolve('concurrency-test.sol'));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
      for (const res of results) {
        expect(res).toBe(owner.toBase58());
      }
      expect(rpc.readCalls).toBe(1);
    });

    it('coalesces 50 concurrent reverse lookups for the same uncached wallet into 1 RPC flow', async () => {
      const wallet = Keypair.generate().publicKey;
      seedWalletRecord(rpc, wallet, 'trucker-coalesce');
      rpc.delayMs = 25;

      const promises = Array.from({ length: 50 }, () => adapter.reverse(wallet.toBase58()));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
      for (const res of results) {
        expect(res).toBe('trucker-coalesce.sol');
      }
      // Single RPC flow consists of getAccountInfo (favorite) + getMultipleAccountsInfo (domain+reverse)
      expect(rpc.readCalls).toBe(2);
    });

    it('coalesces 50 concurrent reverse lookups for an unregistered wallet into 1 RPC call', async () => {
      const wallet = Keypair.generate().publicKey;
      rpc.delayMs = 25;

      const promises = Array.from({ length: 50 }, () => adapter.reverse(wallet.toBase58()));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
      for (const res of results) {
        expect(res).toBeNull();
      }
      // Unregistered wallet only makes favorite lookup and stops
      expect(rpc.readCalls).toBe(1);
    });

    it('coalesces requests even with an asynchronous network-backed cache delay', async () => {
      const slowCache = new DelayedAsyncCache(10);
      const slowAdapter = new SnsNameServiceAdapter(env, slowCache, rpc);
      const owner = Keypair.generate().publicKey;
      const domainKey = getDomainKey('slow-cache-test');
      rpc.mockAccounts.set(domainKey.toBase58(), makeDomainAccount(owner));
      rpc.delayMs = 20;

      const results = await Promise.all(Array.from({ length: 30 }, () => slowAdapter.resolve('slow-cache-test.sol')));
      expect(results).toHaveLength(30);
      for (const res of results) expect(res).toBe(owner.toBase58());
      expect(rpc.readCalls).toBe(1);
    });

    it('cleans up in-flight promises so subsequent queries after completion use cache', async () => {
      const owner = Keypair.generate().publicKey;
      const domainKey = getDomainKey('burst-test');
      rpc.mockAccounts.set(domainKey.toBase58(), makeDomainAccount(owner));

      // First burst
      await Promise.all(Array.from({ length: 25 }, () => adapter.resolve('burst-test.sol')));
      expect(rpc.readCalls).toBe(1);

      // Second burst after in-flight completed: must hit cache and make 0 new RPC calls
      const burst2 = await Promise.all(Array.from({ length: 25 }, () => adapter.resolve('burst-test.sol')));
      for (const res of burst2) {
        expect(res).toBe(owner.toBase58());
      }
      expect(rpc.readCalls).toBe(1);
    });

    it('coalesces 100 concurrent forward and reverse lookups under high load', async () => {
      const owner = Keypair.generate().publicKey;
      const domainKey = getDomainKey('high-load-test');
      rpc.mockAccounts.set(domainKey.toBase58(), makeDomainAccount(owner));
      rpc.delayMs = 25;

      const fwdResults = await Promise.all(
        Array.from({ length: 100 }, () => adapter.resolve('high-load-test.sol')),
      );
      expect(fwdResults).toHaveLength(100);
      for (const res of fwdResults) expect(res).toBe(owner.toBase58());
      expect(rpc.readCalls).toBe(1);

      const wallet = Keypair.generate().publicKey;
      seedWalletRecord(rpc, wallet, 'high-load-driver');

      const revResults = await Promise.all(
        Array.from({ length: 100 }, () => adapter.reverse(wallet.toBase58())),
      );
      expect(revResults).toHaveLength(100);
      for (const res of revResults) expect(res).toBe('high-load-driver.sol');
      // 1 from fwd + 2 from rev (favorite + candidate) = 3 total read calls
      expect(rpc.readCalls).toBe(3);
    });
  });

  describe('2. Negative Caching of Unregistered Accounts & Domains', () => {
    it('negatively caches unregistered domain for exactly 1800s and blocks redundant calls', async () => {
      const res1 = await adapter.resolve('not-registered.sol');
      expect(res1).toBeNull();
      expect(rpc.readCalls).toBe(1);

      // 20 sequential calls should hit negative cache without touching RPC
      for (let i = 0; i < 20; i++) {
        const cached = await adapter.resolve('not-registered.sol');
        expect(cached).toBeNull();
      }
      expect(rpc.readCalls).toBe(1);

      // Advance clock to 1799s (just before expiration)
      clock.advance(1799);
      expect(await adapter.resolve('not-registered.sol')).toBeNull();
      expect(rpc.readCalls).toBe(1);

      // Advance clock past 1800s -> negative cache expires, triggers exactly 1 new RPC call
      clock.advance(2);
      expect(await adapter.resolve('not-registered.sol')).toBeNull();
      expect(rpc.readCalls).toBe(2);
    });

    it('negatively caches unregistered wallet reverse lookup and expires after 1800s', async () => {
      const wallet = Keypair.generate().publicKey.toBase58();
      const res1 = await adapter.reverse(wallet);
      expect(res1).toBeNull();
      expect(rpc.readCalls).toBe(1);

      // 20 repeated lookups
      for (let i = 0; i < 20; i++) {
        expect(await adapter.reverse(wallet)).toBeNull();
      }
      expect(rpc.readCalls).toBe(1);

      // At 1800s - 1s -> still cached
      clock.advance(1799);
      expect(await adapter.reverse(wallet)).toBeNull();
      expect(rpc.readCalls).toBe(1);

      // After 1800s -> expires and re-fetches
      clock.advance(5);
      expect(await adapter.reverse(wallet)).toBeNull();
      expect(rpc.readCalls).toBe(2);
    });

    it('positively caches resolved domain for 3600s when configured and expires after 3600s', async () => {
      const customEnv = makeEnv({ snsCacheTtlSeconds: 3600 });
      const customAdapter = new SnsNameServiceAdapter(customEnv, cache, rpc);
      const owner = Keypair.generate().publicKey;
      const domainKey = getDomainKey('ttl-3600-test');
      rpc.mockAccounts.set(domainKey.toBase58(), makeDomainAccount(owner));

      const first = await customAdapter.resolve('ttl-3600-test.sol');
      expect(first).toBe(owner.toBase58());
      expect(rpc.readCalls).toBe(1);

      // Advance clock by 3599s -> still cached
      clock.advance(3599);
      const second = await customAdapter.resolve('ttl-3600-test.sol');
      expect(second).toBe(owner.toBase58());
      expect(rpc.readCalls).toBe(1);

      // Advance past 3600s (e.g. +2s -> 3601s) -> expires, re-queries RPC
      clock.advance(2);
      const third = await customAdapter.resolve('ttl-3600-test.sol');
      expect(third).toBe(owner.toBase58());
      expect(rpc.readCalls).toBe(2);
    });

    it('positively caches reverse resolution for 3600s and expires cleanly', async () => {
      const customEnv = makeEnv({ snsCacheTtlSeconds: 3600 });
      const customAdapter = new SnsNameServiceAdapter(customEnv, cache, rpc);
      const wallet = Keypair.generate().publicKey;
      seedWalletRecord(rpc, wallet, 'ttl-driver');

      const first = await customAdapter.reverse(wallet.toBase58());
      expect(first).toBe('ttl-driver.sol');
      expect(rpc.readCalls).toBe(2);

      // Advance clock to 3599s -> still cached
      clock.advance(3599);
      const second = await customAdapter.reverse(wallet.toBase58());
      expect(second).toBe('ttl-driver.sol');
      expect(rpc.readCalls).toBe(2);

      // Advance clock past 3600s -> expires and triggers re-fetch
      clock.advance(2);
      const third = await customAdapter.reverse(wallet.toBase58());
      expect(third).toBe('ttl-driver.sol');
      expect(rpc.readCalls).toBe(4);
    });
  });

  describe('3. Batch Lookup Efficiency (<= 2 RPC calls for 50 wallets)', () => {
    it('resolves 50 registered wallets in exactly 2 batched RPC calls', async () => {
      const wallets: string[] = [];
      for (let i = 0; i < 50; i++) {
        const kp = Keypair.generate();
        seedWalletRecord(rpc, kp.publicKey, `driver-${i}`);
        wallets.push(kp.publicKey.toBase58());
      }

      const results = await adapter.reverseBatch(wallets);

      expect(results.size).toBe(50);
      for (let i = 0; i < 50; i++) {
        expect(results.get(wallets[i]!)).toBe(`driver-${i}.sol`);
      }
      // Efficiency check: exactly 2 RPC calls (1 for 50 favorite accounts, 1 for 100 name+reverse accounts)
      expect(rpc.readCalls).toBe(2);
      expect(rpc.batchCalls).toBe(2);
      expect(rpc.singleCalls).toBe(0);
      expect(rpc.requestedKeyBatches[0]).toHaveLength(50);
      expect(rpc.requestedKeyBatches[1]).toHaveLength(100);
    });

    it('resolves 50 unregistered wallets in exactly 1 batched RPC call', async () => {
      const wallets = Array.from({ length: 50 }, () => Keypair.generate().publicKey.toBase58());

      const results = await adapter.reverseBatch(wallets);

      expect(results.size).toBe(50);
      for (const w of wallets) {
        expect(results.get(w)).toBeNull();
      }
      // All 50 missing favorite account -> candidates length 0 -> second call skipped!
      expect(rpc.readCalls).toBe(1);
      expect(rpc.batchCalls).toBe(1);
      expect(rpc.requestedKeyBatches[0]).toHaveLength(50);
    });

    it('resolves 25 registered and 25 unregistered wallets in exactly 2 RPC calls', async () => {
      const wallets: string[] = [];
      for (let i = 0; i < 25; i++) {
        const kp = Keypair.generate();
        seedWalletRecord(rpc, kp.publicKey, `mixed-driver-${i}`);
        wallets.push(kp.publicKey.toBase58());
      }
      for (let i = 25; i < 50; i++) {
        wallets.push(Keypair.generate().publicKey.toBase58());
      }

      const results = await adapter.reverseBatch(wallets);

      expect(results.size).toBe(50);
      for (let i = 0; i < 25; i++) {
        expect(results.get(wallets[i]!)).toBe(`mixed-driver-${i}.sol`);
      }
      for (let i = 25; i < 50; i++) {
        expect(results.get(wallets[i]!)).toBeNull();
      }
      expect(rpc.readCalls).toBe(2);
      expect(rpc.requestedKeyBatches[0]).toHaveLength(50);
      expect(rpc.requestedKeyBatches[1]).toHaveLength(50); // 25 candidates * 2 keys = 50
    });

    it('executes 0 RPC calls when re-querying the 50 wallets due to positive and negative cache', async () => {
      const wallets: string[] = [];
      for (let i = 0; i < 25; i++) {
        const kp = Keypair.generate();
        seedWalletRecord(rpc, kp.publicKey, `cached-batch-${i}`);
        wallets.push(kp.publicKey.toBase58());
      }
      for (let i = 25; i < 50; i++) {
        wallets.push(Keypair.generate().publicKey.toBase58());
      }

      await adapter.reverseBatch(wallets);
      expect(rpc.readCalls).toBe(2);

      // Re-run batch immediately: should make 0 new RPC calls
      const cachedResults = await adapter.reverseBatch(wallets);
      expect(cachedResults.size).toBe(50);
      for (let i = 0; i < 25; i++) {
        expect(cachedResults.get(wallets[i]!)).toBe(`cached-batch-${i}.sol`);
      }
      for (let i = 25; i < 50; i++) {
        expect(cachedResults.get(wallets[i]!)).toBeNull();
      }
      expect(rpc.readCalls).toBe(2); // No new calls
    });

    it('deduplicates 50 duplicate wallet entries and filters invalid addresses', async () => {
      const kp = Keypair.generate();
      seedWalletRecord(rpc, kp.publicKey, `unique-driver`);
      const duplicates = Array.from({ length: 45 }, () => kp.publicKey.toBase58());
      const invalids = ['not-valid-1', 'not-valid-2', '', 'bad-base-58', '123'];

      const batch = await adapter.reverseBatch([...duplicates, ...invalids]);

      expect(batch.get(kp.publicKey.toBase58())).toBe('unique-driver.sol');
      for (const inv of invalids) {
        expect(batch.get(inv)).toBeNull();
      }
      // Exactly 1 unique wallet queried -> 1 favorite call + 1 candidate call
      expect(rpc.readCalls).toBe(2);
      expect(rpc.requestedKeyBatches[0]).toHaveLength(1);
    });

    it('correctly chunks 150 registered wallets into batches of <= 100 accounts without throwing RPC errors', async () => {
      const wallets: string[] = [];
      for (let i = 0; i < 150; i++) {
        const kp = Keypair.generate();
        seedWalletRecord(rpc, kp.publicKey, `large-batch-${i}`);
        wallets.push(kp.publicKey.toBase58());
      }

      const results = await adapter.reverseBatch(wallets);

      expect(results.size).toBe(150);
      for (let i = 0; i < 150; i++) {
        expect(results.get(wallets[i]!)).toBe(`large-batch-${i}.sol`);
      }

      // Verify that every single batch call made had keys.length <= 100
      for (const batch of rpc.requestedKeyBatches) {
        expect(batch.length).toBeLessThanOrEqual(100);
      }

      // Breakdown:
      // favKeys: 150 -> chunks of 100 and 50 (2 calls)
      // candidates: 150 -> fetchKeys: 300 -> chunks of 100, 100, 100 (3 calls)
      // Total: exactly 5 batch calls
      expect(rpc.batchCalls).toBe(5);
      expect(rpc.requestedKeyBatches[0]).toHaveLength(100);
      expect(rpc.requestedKeyBatches[1]).toHaveLength(50);
      expect(rpc.requestedKeyBatches[2]).toHaveLength(100);
      expect(rpc.requestedKeyBatches[3]).toHaveLength(100);
      expect(rpc.requestedKeyBatches[4]).toHaveLength(100);
    });

    it('correctly chunks 175 registered wallets into batches of <= 100 accounts without throwing RPC errors', async () => {
      const wallets: string[] = [];
      for (let i = 0; i < 175; i++) {
        const kp = Keypair.generate();
        seedWalletRecord(rpc, kp.publicKey, `chunk-175-${i}`);
        wallets.push(kp.publicKey.toBase58());
      }

      const results = await adapter.reverseBatch(wallets);

      expect(results.size).toBe(175);
      for (let i = 0; i < 175; i++) {
        expect(results.get(wallets[i]!)).toBe(`chunk-175-${i}.sol`);
      }

      for (const batch of rpc.requestedKeyBatches) {
        expect(batch.length).toBeLessThanOrEqual(100);
      }

      // favKeys: 175 -> chunks of 100, 75 (2 calls)
      // candidates: 175 -> fetchKeys: 350 -> chunks of 100, 100, 100, 50 (4 calls)
      // Total: 6 batch calls
      expect(rpc.batchCalls).toBe(6);
      expect(rpc.requestedKeyBatches[0]).toHaveLength(100);
      expect(rpc.requestedKeyBatches[1]).toHaveLength(75);
      expect(rpc.requestedKeyBatches[2]).toHaveLength(100);
      expect(rpc.requestedKeyBatches[3]).toHaveLength(100);
      expect(rpc.requestedKeyBatches[4]).toHaveLength(100);
      expect(rpc.requestedKeyBatches[5]).toHaveLength(50);
    });

    it('correctly chunks 200 mixed wallets (100 registered, 100 unregistered) into batches of <= 100 accounts', async () => {
      const wallets: string[] = [];
      for (let i = 0; i < 100; i++) {
        const kp = Keypair.generate();
        seedWalletRecord(rpc, kp.publicKey, `mixed-200-${i}`);
        wallets.push(kp.publicKey.toBase58());
      }
      for (let i = 100; i < 200; i++) {
        wallets.push(Keypair.generate().publicKey.toBase58());
      }

      const results = await adapter.reverseBatch(wallets);

      expect(results.size).toBe(200);
      for (let i = 0; i < 100; i++) {
        expect(results.get(wallets[i]!)).toBe(`mixed-200-${i}.sol`);
      }
      for (let i = 100; i < 200; i++) {
        expect(results.get(wallets[i]!)).toBeNull();
      }

      for (const batch of rpc.requestedKeyBatches) {
        expect(batch.length).toBeLessThanOrEqual(100);
      }

      // favKeys: 200 -> chunks of 100, 100 (2 calls)
      // candidates: 100 -> fetchKeys: 200 -> chunks of 100, 100 (2 calls)
      // Total: 4 batch calls
      expect(rpc.batchCalls).toBe(4);
      expect(rpc.requestedKeyBatches[0]).toHaveLength(100);
      expect(rpc.requestedKeyBatches[1]).toHaveLength(100);
      expect(rpc.requestedKeyBatches[2]).toHaveLength(100);
      expect(rpc.requestedKeyBatches[3]).toHaveLength(100);
    });
  });

  describe('4. Upstream RPC Network Timeouts, 429s, and 500s Fault Tolerance', () => {
    it('gracefully handles upstream network timeouts (> 3000ms) returning null without throwing', async () => {
      rpc.delayMs = 3200; // Exceeds RPC_TIMEOUT_MS = 3000ms

      const result = await adapter.resolve('timeout-test.sol');
      expect(result).toBeNull();

      const reverseResult = await adapter.reverse(Keypair.generate().publicKey.toBase58());
      expect(reverseResult).toBeNull();
    }, 10000);

    it('gracefully handles upstream HTTP 429 rate limit errors returning null without throwing', async () => {
      rpc.failWith = new Error('HTTP 429 Too Many Requests: Rate limit exceeded');

      const forwardRes = await adapter.resolve('rate-limited.sol');
      expect(forwardRes).toBeNull();

      const reverseRes = await adapter.reverse(Keypair.generate().publicKey.toBase58());
      expect(reverseRes).toBeNull();

      const batchRes = await adapter.reverseBatch([Keypair.generate().publicKey.toBase58()]);
      expect(batchRes.size).toBe(1);
      expect([...batchRes.values()][0]).toBeNull();
    });

    it('gracefully handles upstream HTTP 500 internal server errors returning null without throwing', async () => {
      rpc.failWith = new Error('HTTP 500 Internal Server Error');

      expect(await adapter.resolve('server-error.sol')).toBeNull();
      expect(await adapter.reverse(Keypair.generate().publicKey.toBase58())).toBeNull();
      const batch = await adapter.reverseBatch([Keypair.generate().publicKey.toBase58()]);
      expect([...batch.values()][0]).toBeNull();
    });

    it('does NOT write negative cache on transient RPC 429/500/timeout failures', async () => {
      const owner = Keypair.generate().publicKey;
      const domainKey = getDomainKey('transient-error');
      rpc.mockAccounts.set(domainKey.toBase58(), makeDomainAccount(owner));

      // Simulate temporary RPC outage
      rpc.failWith = new Error('HTTP 429 Too Many Requests');
      const failRes = await adapter.resolve('transient-error.sol');
      expect(failRes).toBeNull();
      expect(rpc.readCalls).toBe(1);

      // RPC recovers
      rpc.failWith = null;
      const recoveredRes = await adapter.resolve('transient-error.sol');
      expect(recoveredRes).toBe(owner.toBase58());
      // Because transient failure was not cached negatively, recovery triggers immediate lookup
      expect(rpc.readCalls).toBe(2);
    });

    it('recovers via fallback RPC when primary RPC throws 429', async () => {
      const wallet = Keypair.generate().publicKey;
      const primaryMock = {
        getAccountInfo: async () => {
          throw new Error('429 Rate limit exceeded on primary');
        },
      };
      const fallbackMock = {
        getAccountInfo: async (key: PublicKey) => {
          const favKey = getFavoriteKey(wallet);
          if (key.equals(favKey)) {
            const nameAccount = Keypair.generate().publicKey;
            return makeFavoriteAccount(nameAccount);
          }
          return null;
        },
        getMultipleAccountsInfo: async (keys: PublicKey[]) => {
          return [makeDomainAccount(wallet), makeReverseAccount('fallback-winner')];
        },
      };

      const realSolanaRpc = new SolanaRpc(
        primaryMock as any,
        [fallbackMock as any],
        async () => {}, // Instant wait for testing
        0,
      );

      const fallbackAdapter = new SnsNameServiceAdapter(env, cache, realSolanaRpc);
      const res = await fallbackAdapter.reverse(wallet.toBase58());
      expect(res).toBe('fallback-winner.sol');
    });
  });

  describe('5. CQRS Handlers and HTTP Controller Error Resilience', () => {
    it('SnsHttpController endpoints return 200 with null values when RPC is down', async () => {
      rpc.failWith = new Error('RPC connection refused');

      const reverseHandler = new GetSnsReverseHandler(adapter);
      const resolveHandler = new ResolveSnsHandler(adapter);

      const fakeQueryBus = {
        execute: async (query: any) => {
          if ('wallet' in query) return reverseHandler.execute(query);
          if ('domain' in query) return resolveHandler.execute(query);
          throw new Error('unknown query');
        },
      };

      const controller = new SnsHttpController(fakeQueryBus as any);

      const rev = await controller.reverse({ wallet: Keypair.generate().publicKey.toBase58() });
      expect(rev.domain).toBeNull();

      const fwd = await controller.resolve({ domain: 'failing.sol' });
      expect(fwd.wallet).toBeNull();
    });

    it('GetLeaderboardHandler does not throw when RPC fails and leaves sns null', async () => {
      const ctx = unitContext();
      rpc.failWith = new Error('500 Solana RPC failure');

      const handler = new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery, ctx.rules, adapter);
      const board = await handler.execute(new GetLeaderboardQuery('round'));
      expect(board).toBeDefined();
      expect(board.rows).toEqual([]);
    });

    it('GetProfileHandler does not throw when RPC fails and omits or nulls sns', async () => {
      const ctx = unitContext();
      rpc.failWith = new Error('500 Solana RPC failure');

      const wallet = Keypair.generate().publicKey.toBase58();
      const handler = new GetProfileHandler(
        ctx.sessions,
        ctx.achievements,
        ctx.rideQuery,
        ctx.payments,
        ctx.rules,
        ctx.clock,
        ctx.poolTickets,
        ctx.tickets,
        ctx.orders,
        new RecordingAnalytics(),
        ctx.stats,
        adapter,
      );

      const profile = await handler.execute(new GetProfileQuery(wallet));
      expect(profile).toBeDefined();
      expect(profile.wallet).toBe(wallet);
      expect(profile.sns).toBeNull();
    });

    it('MeProfileService does not throw when RPC fails and omits or nulls sns', async () => {
      const ctx = unitContext();
      rpc.failWith = new Error('500 Solana RPC failure');

      const wallet = Keypair.generate().publicKey.toBase58();
      const player = await ctx.sessions.touch(wallet, ctx.now());
      const meService = new MeProfileService(ctx.rules, ctx.poolTickets, ctx.rides, adapter);

      const me = await meService.of(player, ctx.now());
      expect(me).toBeDefined();
      expect(me.wallet).toBe(wallet);
      expect(me.sns).toBeNull();
    });

    it('GetPublicRideHandler does not throw when RPC fails and sets sns null', async () => {
      const ctx = unitContext();
      rpc.failWith = new Error('500 Solana RPC failure');

      const wallet = Keypair.generate().publicKey.toBase58();
      const ride = await ctx.freeRide(wallet);
      const handler = new GetPublicRideHandler(ctx.rides, ctx.verdictRepo, adapter);

      const dto = await handler.execute(new GetPublicRideQuery(ride.id));
      expect(dto).toBeDefined();
      expect(dto.id).toBe(ride.id);
      expect(dto.sns).toBeNull();
    });
  });
});
