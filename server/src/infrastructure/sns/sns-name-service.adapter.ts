import { Injectable, Logger, Optional } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { NameServicePort } from '../../application/ports/sns/name-service.port.js';
import { CachePort } from '../../application/ports/shared/cache.port.js';
import { EnvService } from '../config/env.service.js';
import { SolanaRpc } from '../solana/solana-rpc.js';
import { isWalletAddress } from '../../domain/players/wallet-address.js';

// Protocol Constants
const NAME_PROGRAM_ID = new PublicKey('namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX');
const ROOT_DOMAIN_ACCOUNT = new PublicKey('58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx');
const NAME_FAVORITE_ID = new PublicKey('85iDfUvr3HJyLM2zcq5BXSiDvUWfw6cSE1FfNBo8Ap29');
const REVERSE_LOOKUP_CLASS = new PublicKey('33m47vH6Eav6jr5Ry86XjhRft2jRBLDnDgPSHoquXi2Z');
const HASH_PREFIX = 'SPL Name Service';
const RPC_TIMEOUT_MS = 3000;

function hashBuffer(prefix: string, value: string): Buffer {
  return createHash('sha256').update(Buffer.from(prefix + value, 'utf8')).digest();
}

export function getDomainKey(label: string): PublicKey {
  const hashed = hashBuffer(HASH_PREFIX, label);
  const [key] = PublicKey.findProgramAddressSync(
    [hashed, Buffer.alloc(32), ROOT_DOMAIN_ACCOUNT.toBuffer()],
    NAME_PROGRAM_ID,
  );
  return key;
}

export function getFavoriteKey(wallet: PublicKey): PublicKey {
  const [key] = PublicKey.findProgramAddressSync(
    [Buffer.from('favourite_domain'), wallet.toBuffer()],
    NAME_FAVORITE_ID,
  );
  return key;
}

export function getReverseKey(domainKey: PublicKey): PublicKey {
  const hashed = hashBuffer(HASH_PREFIX, domainKey.toBase58());
  const [key] = PublicKey.findProgramAddressSync(
    [hashed, REVERSE_LOOKUP_CLASS.toBuffer(), Buffer.alloc(32)],
    NAME_PROGRAM_ID,
  );
  return key;
}

@Injectable()
export class SnsNameServiceAdapter extends NameServicePort {
  private readonly logger = new Logger(SnsNameServiceAdapter.name);
  private readonly rpc: SolanaRpc;
  private readonly positiveTtlSeconds: number;
  private readonly negativeTtlSeconds: number;
  private readonly inFlightReverse = new Map<string, Promise<string | null>>();
  private readonly inFlightResolve = new Map<string, Promise<string | null>>();

  constructor(
    env: EnvService,
    private readonly cache: CachePort,
    @Optional() rpc?: SolanaRpc,
  ) {
    super();
    this.positiveTtlSeconds = env.snsCacheTtlSeconds;
    this.negativeTtlSeconds = env.snsNegativeCacheTtlSeconds;
    this.rpc =
      rpc ??
      new SolanaRpc(
        new Connection(env.snsRpc, { commitment: 'confirmed' }),
        env.snsRpcFallbacks.map((u) => new Connection(u, { commitment: 'confirmed' })),
      );
  }

  async resolve(domain: string): Promise<string | null> {
    if (!domain || typeof domain !== 'string') return null;
    const label = domain.trim().toLowerCase().replace(/\.(sol|sns)$/, '');
    if (!label || label.length > 64 || !/^[a-z0-9_-]+$/.test(label)) return null;

    const cacheKey = `sns:fwd:${label}`;
    const cached = await this.cache.get<{ wallet: string | null }>(cacheKey);
    if (cached !== null) return cached.wallet;

    const existing = this.inFlightResolve.get(label);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const domainKey = getDomainKey(label);
        const account = await this.rpcCall((conn) => conn.getAccountInfo(domainKey));
        if (!account || account.data.length < 64) {
          await this.cache.set(cacheKey, { wallet: null }, this.negativeTtlSeconds);
          return null;
        }
        const owner = new PublicKey(account.data.subarray(32, 64)).toBase58();
        await this.cache.set(cacheKey, { wallet: owner }, this.positiveTtlSeconds);
        return owner;
      } catch (err) {
        this.logger.warn(`Forward SNS lookup failed for ${domain}: ${(err as Error).message}`);
        return null;
      }
    })();

    this.inFlightResolve.set(label, promise);
    try {
      return await promise;
    } finally {
      this.inFlightResolve.delete(label);
    }
  }

  async reverse(wallet: string): Promise<string | null> {
    if (!wallet || !isWalletAddress(wallet)) return null;

    const cacheKey = `sns:rev:${wallet}`;
    const cached = await this.cache.get<{ name: string | null }>(cacheKey);
    if (cached !== null) return cached.name;

    const existing = this.inFlightReverse.get(wallet);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const walletPubkey = new PublicKey(wallet);
        const favKey = getFavoriteKey(walletPubkey);
        const favAccount = await this.rpcCall((conn) => conn.getAccountInfo(favKey));
        if (!favAccount || favAccount.data.length < 33) {
          await this.cache.set(cacheKey, { name: null }, this.negativeTtlSeconds);
          return null;
        }

        const nameAccount = new PublicKey(favAccount.data.subarray(1, 33));
        const reverseKey = getReverseKey(nameAccount);
        const [domainAcc, reverseAcc] = await this.rpcCall((conn) =>
          conn.getMultipleAccountsInfo([nameAccount, reverseKey]),
        );

        if (!domainAcc || domainAcc.data.length < 64 || !reverseAcc || reverseAcc.data.length < 100) {
          await this.cache.set(cacheKey, { name: null }, this.negativeTtlSeconds);
          return null;
        }

        // Staleness check: domain owner must match wallet
        const currentOwner = new PublicKey(domainAcc.data.subarray(32, 64)).toBase58();
        if (currentOwner !== wallet) {
          this.logger.debug(`Stale favorite domain detected for ${wallet}: owned by ${currentOwner}`);
          await this.cache.set(cacheKey, { name: null }, this.negativeTtlSeconds);
          return null;
        }

        const nameLen = reverseAcc.data.readUInt32LE(96);
        if (nameLen === 0 || 100 + nameLen > reverseAcc.data.length) {
          await this.cache.set(cacheKey, { name: null }, this.negativeTtlSeconds);
          return null;
        }

        const label = reverseAcc.data.subarray(100, 100 + nameLen).toString('utf8').replace(/\0/g, '').trim().toLowerCase();
        if (!label) {
          await this.cache.set(cacheKey, { name: null }, this.negativeTtlSeconds);
          return null;
        }

        const domainName = `${label.replace(/\.sol$/, '')}.sol`;
        await this.cache.set(cacheKey, { name: domainName }, this.positiveTtlSeconds);
        return domainName;
      } catch (err) {
        this.logger.warn(`Reverse SNS lookup failed for ${wallet}: ${(err as Error).message}`);
        return null;
      }
    })();

    this.inFlightReverse.set(wallet, promise);
    try {
      return await promise;
    } finally {
      this.inFlightReverse.delete(wallet);
    }
  }

  async reverseBatch(wallets: readonly string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    const validWallets = [...new Set(wallets.filter(isWalletAddress))];

    for (const w of wallets) {
      if (!isWalletAddress(w)) results.set(w, null);
    }
    if (validWallets.length === 0) return results;

    const misses: string[] = [];
    await Promise.all(
      validWallets.map(async (w) => {
        const cached = await this.cache.get<{ name: string | null }>(`sns:rev:${w}`);
        if (cached !== null) {
          results.set(w, cached.name);
        } else {
          misses.push(w);
        }
      }),
    );

    if (misses.length === 0) return results;

    try {
      const favKeys = misses.map((w) => getFavoriteKey(new PublicKey(w)));
      const favAccounts = await this.rpcCall((conn) => conn.getMultipleAccountsInfo(favKeys));

      const candidates: { wallet: string; nameAccount: PublicKey; reverseKey: PublicKey }[] = [];
      for (let i = 0; i < misses.length; i++) {
        const wallet = misses[i]!;
        const fav = favAccounts[i];
        if (!fav || fav.data.length < 33) {
          results.set(wallet, null);
          await this.cache.set(`sns:rev:${wallet}`, { name: null }, this.negativeTtlSeconds);
        } else {
          const nameAccount = new PublicKey(fav.data.subarray(1, 33));
          const reverseKey = getReverseKey(nameAccount);
          candidates.push({ wallet, nameAccount, reverseKey });
        }
      }

      if (candidates.length > 0) {
        const fetchKeys: PublicKey[] = [];
        for (const c of candidates) {
          fetchKeys.push(c.nameAccount, c.reverseKey);
        }

        const accounts = await this.rpcCall((conn) => conn.getMultipleAccountsInfo(fetchKeys));
        for (let j = 0; j < candidates.length; j++) {
          const c = candidates[j]!;
          const domainAcc = accounts[j * 2];
          const reverseAcc = accounts[j * 2 + 1];

          if (!domainAcc || domainAcc.data.length < 64 || !reverseAcc || reverseAcc.data.length < 100) {
            results.set(c.wallet, null);
            await this.cache.set(`sns:rev:${c.wallet}`, { name: null }, this.negativeTtlSeconds);
            continue;
          }

          const owner = new PublicKey(domainAcc.data.subarray(32, 64)).toBase58();
          if (owner !== c.wallet) {
            results.set(c.wallet, null);
            await this.cache.set(`sns:rev:${c.wallet}`, { name: null }, this.negativeTtlSeconds);
            continue;
          }

          const nameLen = reverseAcc.data.readUInt32LE(96);
          if (nameLen === 0 || 100 + nameLen > reverseAcc.data.length) {
            results.set(c.wallet, null);
            await this.cache.set(`sns:rev:${c.wallet}`, { name: null }, this.negativeTtlSeconds);
            continue;
          }

          const label = reverseAcc.data.subarray(100, 100 + nameLen).toString('utf8').replace(/\0/g, '').trim().toLowerCase();
          const domainName = `${label.replace(/\.sol$/, '')}.sol`;
          results.set(c.wallet, domainName);
          await this.cache.set(`sns:rev:${c.wallet}`, { name: domainName }, this.positiveTtlSeconds);
        }
      }
    } catch (err) {
      this.logger.warn(`Batch reverse SNS lookup failed: ${(err as Error).message}`);
      for (const w of misses) {
        if (!results.has(w)) results.set(w, null);
      }
    }

    return results;
  }

  override async reverseLookup(wallet: string): Promise<string | null> {
    return this.reverse(wallet);
  }

  override async reverseLookupBatch(wallets: readonly string[]): Promise<Map<string, string | null>> {
    return this.reverseBatch(wallets);
  }

  private async rpcCall<T>(call: (conn: Connection) => Promise<T>): Promise<T> {
    let timerId: NodeJS.Timeout | undefined;
    const timer = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error('SNS RPC request timed out')), RPC_TIMEOUT_MS);
      timerId.unref?.();
    });
    try {
      return await Promise.race([this.rpc.read(call), timer]);
    } finally {
      if (timerId) clearTimeout(timerId);
    }
  }
}
