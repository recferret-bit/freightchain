import { AccountInfo, Keypair, PublicKey } from '@solana/web3.js';
import {
  SnsNameServiceAdapter,
  getDomainKey,
  getFavoriteKey,
  getReverseKey,
} from '../../../../src/infrastructure/sns/sns-name-service.adapter.js';
import { MemoryCacheAdapter } from '../../../../src/infrastructure/cache/memory-cache.adapter.js';
import { FakeClock } from '../../../support/fake-clock.js';
import { SolanaRpc } from '../../../../src/infrastructure/solana/solana-rpc.js';
import { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import {
  extractDomainLabel,
  formatDriverDisplay,
  isDomainName,
  normalizeDomainName,
  parseDomainName,
} from '../../../../src/domain/sns/sns-name.js';
import { isWalletAddress } from '../../../../src/domain/players/wallet-address.js';
import { BadRequestError } from '../../../../src/domain/shared/errors.js';
import { GetSnsReverseHandler } from '../../../../src/application/use-cases/sns/get-sns-reverse/get-sns-reverse.handler.js';
import { GetSnsReverseQuery } from '../../../../src/application/use-cases/sns/get-sns-reverse/get-sns-reverse.query.js';
import { ResolveSnsHandler } from '../../../../src/application/use-cases/sns/resolve-sns/resolve-sns.handler.js';
import { ResolveSnsQuery } from '../../../../src/application/use-cases/sns/resolve-sns/resolve-sns.query.js';

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
      getAccountInfo: async (key: PublicKey) => this.mockAccounts.get(key.toBase58()) ?? null,
      getMultipleAccountsInfo: async (keys: PublicKey[]) =>
        keys.map((k) => this.mockAccounts.get(k.toBase58()) ?? null),
    };
    return call(fakeConn);
  }
}

function makeEnv(): EnvService {
  return {
    snsRpc: 'https://api.mainnet-beta.solana.com',
    snsRpcFallbacks: [],
    snsCacheTtlSeconds: 86400,
    snsNegativeCacheTtlSeconds: 1800,
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

function makeTamperedReverseAccount(declaredLen: number, payload: Buffer): AccountInfo<Buffer> {
  const buf = Buffer.alloc(100 + payload.length);
  buf.writeUInt32LE(declaredLen, 96);
  payload.copy(buf, 100);
  return makeAccountInfo(buf);
}

describe('SNS Adversarial & Boundary Stress Test Suite', () => {
  let clock: FakeClock;
  let cache: MemoryCacheAdapter;
  let rpc: MockSolanaRpc;
  let adapter: SnsNameServiceAdapter;

  beforeEach(() => {
    clock = new FakeClock();
    cache = new MemoryCacheAdapter(clock);
    rpc = new MockSolanaRpc();
    adapter = new SnsNameServiceAdapter(makeEnv(), cache, rpc);
  });

  describe('1. Malformed Domain Inputs & Homoglyphs', () => {
    const homoglyphDomains = [
      'аlice.sol', // Cyrillic 'а' (U+0430)
      'рay.sol', // Cyrillic 'р' (U+0440)
      'bоnfida.sol', // Cyrillic 'о' (U+043E)
      'drivеr.sol', // Cyrillic 'е' (U+0435)
      'solаnа.sol', // Mixed Latin and Cyrillic
    ];

    it.each(homoglyphDomains)('rejects Cyrillic homoglyph in domain validation: %s', (domain) => {
      expect(isDomainName(domain)).toBe(false);
      expect(() => parseDomainName(domain)).toThrow(BadRequestError);
    });

    it.each(homoglyphDomains)('forward resolve cleanly returns null on homoglyphs without RPC call: %s', async (domain) => {
      const result = await adapter.resolve(domain);
      expect(result).toBeNull();
      expect(rpc.readCalls).toBe(0);
    });

    it('rejects invisible zero-width spaces and RTL overrides', () => {
      expect(isDomainName('bon\u200Bfida.sol')).toBe(false);
      expect(isDomainName('\u202Ebonfida.sol')).toBe(false);
      expect(isDomainName('alice\uFEFF.sol')).toBe(false);
    });

    it('rejects control characters, newlines, and null bytes', () => {
      expect(isDomainName('driver\0.sol')).toBe(false);
      expect(isDomainName('driver\nname.sol')).toBe(false);
      expect(isDomainName('driver\r\n.sol')).toBe(false);
      expect(isDomainName('driver\t.sol')).toBe(false);
    });

    it('rejects emojis and non-alphanumeric unicode', () => {
      expect(isDomainName('🚀.sol')).toBe(false);
      expect(isDomainName('truck🚛.sol')).toBe(false);
      expect(isDomainName('💎driver.sol')).toBe(false);
    });

    it('rejects path traversal, script injection, and SQL injection payloads', () => {
      const malicious = [
        '../evil.sol',
        '..\\evil.sol',
        '<script>alert(1)</script>.sol',
        "' OR '1'='1.sol",
        '"; DROP TABLE players;--.sol',
      ];
      for (const m of malicious) {
        expect(isDomainName(m)).toBe(false);
        expect(() => parseDomainName(m)).toThrow(BadRequestError);
      }
    });

    it('rejects boundary length violations', () => {
      // Label exactly 60 chars (valid)
      const valid60 = 'a'.repeat(60) + '.sol';
      expect(isDomainName(valid60)).toBe(true);

      // Label 61 chars (invalid)
      const invalid61 = 'a'.repeat(61) + '.sol';
      expect(isDomainName(invalid61)).toBe(false);

      // Label 1000 chars (DoS attempt)
      const huge = 'a'.repeat(1000) + '.sol';
      expect(isDomainName(huge)).toBe(false);
      expect(() => parseDomainName(huge)).toThrow(BadRequestError);
    });

    it('handles empty, whitespace, and bare TLD inputs gracefully', async () => {
      const empties = ['', '   ', '\t', '.sol', '.sns', '...sol'];
      for (const e of empties) {
        expect(isDomainName(e)).toBe(false);
        expect(await adapter.resolve(e)).toBeNull();
      }
      expect(rpc.readCalls).toBe(0);
    });

    it('gracefully handles subdomain forward resolution attempt without crashing', async () => {
      const owner = Keypair.generate().publicKey;
      const sub = 'sub.bonfida.sol';
      // parseDomainName accepts subdomain syntactically
      expect(isDomainName(sub)).toBe(true);
      // Adapter forward resolution safely returns null (only top-level names supported)
      expect(await adapter.resolve(sub)).toBeNull();
      expect(rpc.readCalls).toBe(0);
    });
  });

  describe('2. Stale Favorite Domain Accounts (Owner Transfer & Churn)', () => {
    it('detects transferred domain where original wallet favorite PDA still points to it', async () => {
      const originalOwner = Keypair.generate().publicKey;
      const newOwner = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(originalOwner);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(newOwner)); // Transferred!
      rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount('speedy'));

      const result = await adapter.reverse(originalOwner.toBase58());
      expect(result).toBeNull();

      // Ensure negative cache is written so stale record does not repeatedly hammer RPC
      expect(await cache.get(`sns:rev:${originalOwner.toBase58()}`)).toEqual({ name: null });
    });

    it('detects closed or burned domain account (0 lamports / null account)', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), null); // Account closed / burned

      const result = await adapter.reverse(wallet.toBase58());
      expect(result).toBeNull();
      expect(await cache.get(`sns:rev:${wallet.toBase58()}`)).toEqual({ name: null });
    });

    it('detects truncated domain account (< 64 bytes)', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeAccountInfo(Buffer.alloc(63))); // Truncated

      const result = await adapter.reverse(wallet.toBase58());
      expect(result).toBeNull();
    });

    it('batch reverse resolution detects stale accounts among valid ones', async () => {
      const validWallet = Keypair.generate().publicKey;
      const staleWallet = Keypair.generate().publicKey;
      const purchaser = Keypair.generate().publicKey;

      const validName = Keypair.generate().publicKey;
      rpc.mockAccounts.set(getFavoriteKey(validWallet).toBase58(), makeFavoriteAccount(validName));
      rpc.mockAccounts.set(validName.toBase58(), makeDomainAccount(validWallet));
      rpc.mockAccounts.set(getReverseKey(validName).toBase58(), makeReverseAccount('trucker'));

      const staleName = Keypair.generate().publicKey;
      rpc.mockAccounts.set(getFavoriteKey(staleWallet).toBase58(), makeFavoriteAccount(staleName));
      rpc.mockAccounts.set(staleName.toBase58(), makeDomainAccount(purchaser)); // Owned by purchaser now
      rpc.mockAccounts.set(getReverseKey(staleName).toBase58(), makeReverseAccount('old-domain'));

      const batch = await adapter.reverseBatch([validWallet.toBase58(), staleWallet.toBase58()]);
      expect(batch.get(validWallet.toBase58())).toBe('trucker.sol');
      expect(batch.get(staleWallet.toBase58())).toBeNull();
    });
  });

  describe('3. Binary Layout Tampering & Reverse Record Corruptions', () => {
    it('handles favorite account with data length < 33 bytes', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);

      rpc.mockAccounts.set(favKey.toBase58(), makeAccountInfo(Buffer.alloc(32))); // 1 byte short

      expect(await adapter.reverse(wallet.toBase58())).toBeNull();
    });

    it('handles reverse account with data length < 100 bytes', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      rpc.mockAccounts.set(reverseKey.toBase58(), makeAccountInfo(Buffer.alloc(99))); // Truncated header

      expect(await adapter.reverse(wallet.toBase58())).toBeNull();
    });

    it('handles zero-length nameLen in reverse account', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      rpc.mockAccounts.set(reverseKey.toBase58(), makeTamperedReverseAccount(0, Buffer.alloc(0)));

      expect(await adapter.reverse(wallet.toBase58())).toBeNull();
    });

    it('handles declared nameLen exceeding buffer bounds (out-of-bounds / OOB read)', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      // Declares 200 bytes, but payload buffer only has 10 bytes
      rpc.mockAccounts.set(reverseKey.toBase58(), makeTamperedReverseAccount(200, Buffer.alloc(10)));

      expect(await adapter.reverse(wallet.toBase58())).toBeNull();
    });

    it('handles huge 32-bit unsigned integer in nameLen without buffer overflow or crash', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      // 0xFFFFFFFF = 4294967295
      rpc.mockAccounts.set(reverseKey.toBase58(), makeTamperedReverseAccount(0xffffffff, Buffer.alloc(10)));

      expect(await adapter.reverse(wallet.toBase58())).toBeNull();
    });

    it('handles null-byte stuffing in reverse account string', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      // String with trailing null bytes: "driver\0\0\0"
      rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount('driver\0\0\0'));

      expect(await adapter.reverse(wallet.toBase58())).toBe('driver.sol');
    });

    it('handles reverse record payload containing only whitespace or nulls', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount('   '));

      expect(await adapter.reverse(wallet.toBase58())).toBeNull();
    });

    it('handles reverse record payload containing only whitespace in batch lookup', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount('   '));

      const batch = await adapter.reverseBatch([wallet.toBase58()]);
      expect(batch.get(wallet.toBase58())).toBeNull();
    });

    it('rejects reverse record containing malformed characters or script injections', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount('<script>alert(1)</script>'));

      const domain = await adapter.reverse(wallet.toBase58());
      // The resolved domain MUST either be null or a syntactically valid domain name
      expect(domain === null || isDomainName(domain)).toBe(true);
      expect(domain).toBeNull();
    });

    it('rejects reverse record containing Cyrillic homoglyphs', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount('аlice')); // Cyrillic 'а'

      const domain = await adapter.reverse(wallet.toBase58());
      expect(domain === null || isDomainName(domain)).toBe(true);
      expect(domain).toBeNull();
    });

    it('rejects malformed reverse records in batch lookup', async () => {
      const wallet = Keypair.generate().publicKey;
      const favKey = getFavoriteKey(wallet);
      const nameAccount = Keypair.generate().publicKey;
      const reverseKey = getReverseKey(nameAccount);

      rpc.mockAccounts.set(favKey.toBase58(), makeFavoriteAccount(nameAccount));
      rpc.mockAccounts.set(nameAccount.toBase58(), makeDomainAccount(wallet));
      rpc.mockAccounts.set(reverseKey.toBase58(), makeReverseAccount('bad/domain'));

      const batch = await adapter.reverseBatch([wallet.toBase58()]);
      const resolved = batch.get(wallet.toBase58());
      expect(resolved === null || isDomainName(resolved)).toBe(true);
      expect(resolved).toBeNull();
    });
  });

  describe('4. Public Key & Boundary Edge Cases', () => {
    it('handles Solana System Program (all 1s base58) gracefully', async () => {
      const systemProgram = '11111111111111111111111111111111';
      expect(isWalletAddress(systemProgram)).toBe(true);

      // System program has no favorite record
      expect(await adapter.reverse(systemProgram)).toBeNull();
      expect(rpc.readCalls).toBe(1);
    });

    it('rejects invalid base58 characters without calling RPC', async () => {
      const invalidChars = [
        '00000000000000000000000000000000', // '0' is invalid in base58
        'IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII', // 'I' is invalid in base58
        'OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO', // 'O' is invalid in base58
        'llllllllllllllllllllllllllllllll', // 'l' is invalid in base58
      ];

      for (const inv of invalidChars) {
        expect(isWalletAddress(inv)).toBe(false);
        expect(await adapter.reverse(inv)).toBeNull();
      }
      expect(rpc.readCalls).toBe(0);
    });

    it('rejects public keys with invalid byte lengths', async () => {
      const tooShort = '1111111111111111111111111111111'; // 31 chars
      const tooLong = '111111111111111111111111111111111111111111111'; // 45 chars
      expect(isWalletAddress(tooShort)).toBe(false);
      expect(isWalletAddress(tooLong)).toBe(false);
      expect(await adapter.reverse(tooShort)).toBeNull();
      expect(await adapter.reverse(tooLong)).toBeNull();
      expect(rpc.readCalls).toBe(0);
    });

    it('rejects null, undefined, and non-string wallet values', async () => {
      expect(await adapter.reverse(null as any)).toBeNull();
      expect(await adapter.reverse(undefined as any)).toBeNull();
      expect(await adapter.reverse({} as any)).toBeNull();
      expect(await adapter.reverse(12345 as any)).toBeNull();
      expect(rpc.readCalls).toBe(0);
    });
  });

  describe('5. Application CQRS Handlers & Resilience', () => {
    it('GetSnsReverseHandler validates wallet address and returns DTO', async () => {
      const handler = new GetSnsReverseHandler(adapter);
      const wallet = Keypair.generate().publicKey.toBase58();

      const res = await handler.execute(new GetSnsReverseQuery(wallet));
      expect(res).toEqual({ wallet, domain: null });

      // Invalid wallet throws BadRequestError
      await expect(handler.execute(new GetSnsReverseQuery('invalid-wallet'))).rejects.toThrow(BadRequestError);
    });

    it('ResolveSnsHandler validates domain and throws on malformed domain', async () => {
      const handler = new ResolveSnsHandler(adapter);

      // Malformed domain throws BadRequestError
      await expect(handler.execute(new ResolveSnsQuery('bad name.sol'))).rejects.toThrow(BadRequestError);
      await expect(handler.execute(new ResolveSnsQuery('аlice.sol'))).rejects.toThrow(BadRequestError);
      await expect(handler.execute(new ResolveSnsQuery(''))).rejects.toThrow(BadRequestError);
    });

    it('formatDriverDisplay prioritizes valid SNS and falls back cleanly', () => {
      const wallet = '11111111111111111111111111111111';
      expect(formatDriverDisplay(wallet, 'driver.sol')).toBe('driver.sol');
      expect(formatDriverDisplay(wallet, null)).toBe(wallet);
      expect(formatDriverDisplay(wallet, undefined)).toBe(wallet);
      expect(formatDriverDisplay(wallet, '')).toBe(wallet);
      expect(formatDriverDisplay(wallet, '   ')).toBe(wallet);
    });
  });
});
