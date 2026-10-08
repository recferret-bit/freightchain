import { Pool } from '../../src/domain/economy/pool.entity.js';
import type { PoolProps } from '../../src/domain/economy/pool.types.js';
import type { PoolChainState } from '../../src/domain/economy/chain-events.js';

const DAY = 86_400_000;

/** A pool mirror row for tests: 0.05 SOL tickets, min 2, max 5 per wallet, 70 / 20 / 10, prep 7 days and play 14 days after `now`. */
export const poolProps = (over: Partial<PoolProps> = {}, now = new Date(Date.UTC(2036, 9, 8, 12))): PoolProps => ({
  id: 1, address: `PoolPda${String(over.id ?? 1).padStart(37, '1')}`, tier: '1h', label: '1 HOUR · test', priceLamports: 50_000_000,
  minTickets: 2, maxTickets: 0, maxPerWallet: 5, prepDeadline: new Date(now.getTime() + 7 * DAY), playDeadline: new Date(now.getTime() + 14 * DAY),
  prizeBps: 7000, seedBps: 2000, feeBps: 1000, feeTreasury: 'FeeTreasury11111111111111111111111111111111', seedTreasury: 'SeedTreasury1111111111111111111111111111111',
  status: 'open', ticketsSold: 0, buyers: 0, vaultLamports: 0, sponsored: 0, roundId: null, createdAt: now, syncedAt: null,
  ...over,
});

export const aPool = (over: Partial<PoolProps> = {}, now?: Date): Pool => Pool.restore(poolProps(over, now));

/** A pool account as the chain adapter reads it (1h, open, 3 sold, min 10). */
export const chainPool = (now: Date, over: Partial<PoolChainState> = {}): PoolChainState => ({
  poolId: 1, address: 'PoolPda1111111111111111111111111111111111111', status: 'open', ticketsSold: 3, buyers: 2, sponsored: 0, prizesPaid: 0, refunded: 0,
  vaultLamports: 890_880 + 150_000_000, escrowLamports: 150_000_000, vault: 'VaultPda', authority: 'Admin', tier: 1, priceLamports: 50_000_000, minTickets: 10, maxTickets: 0,
  maxPerWallet: 5, prepDeadline: new Date(now.getTime() + 7 * DAY), playDeadline: new Date(now.getTime() + 14 * DAY), prizeBps: 7000, seedBps: 2000, feeBps: 1000,
  feeTreasury: 'Fee', seedTreasury: 'Seed', createdAt: now, ...over,
});
