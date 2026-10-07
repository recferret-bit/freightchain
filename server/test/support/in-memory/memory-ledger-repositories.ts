import { Injectable } from '@nestjs/common';
import { Pool } from '../../../src/domain/economy/pool.entity.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';
import { PromoCode } from '../../../src/domain/economy/promo-code.entity.js';
import { RideTicket } from '../../../src/domain/players/ride-ticket.entity.js';
import type { TicketGrantProps } from '../../../src/domain/players/ride-ticket.types.js';
import type { PaidTierId } from '../../../src/domain/rides/ride-tier.js';
import { VersionConflictError } from '../../../src/domain/shared/errors.js';
import { PoolRepositoryPort } from '../../../src/application/ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../../../src/application/ports/economy/promo.repository.port.js';
import { RideTicketRepositoryPort } from '../../../src/application/ports/players/ride-ticket.repository.port.js';
import type { MemoryDb } from './memory-db.js';

/* In-memory twins of the pool / ticket / promo repositories (same contracts as the Prisma ones; see memory-repositories.ts). */

const soonest = (a: PoolProps, b: PoolProps) => a.playDeadline.getTime() - b.playDeadline.getTime() || a.id - b.id;
const isLive = (p: PoolProps) => p.status === 'open' || p.status === 'active';

@Injectable()
export class MemoryPoolRepository extends PoolRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async findById(id: number): Promise<Pool | null> {
    const p = this.db.pools.get(id);
    return p ? Pool.restore(p) : null;
  }

  findByIdForUpdate(id: number): Promise<Pool | null> { return this.findById(id); }

  async findMany(ids: number[]): Promise<Pool[]> {
    return [...this.db.pools.values()].filter((p) => ids.includes(p.id)).sort((a, b) => a.id - b.id).map((p) => Pool.restore(p));
  }

  async listLive(): Promise<Pool[]> {
    return [...this.db.pools.values()].filter(isLive).sort(soonest).map((p) => Pool.restore(p));
  }

  async listLiveOfTier(tier: PaidTierId): Promise<Pool[]> {
    return (await this.listLive()).filter((p) => p.tier === tier);
  }

  async listOpenPastDeadline(now: Date): Promise<Pool[]> {
    return [...this.db.pools.values()].filter((p) => p.status === 'open' && p.prepDeadline.getTime() <= now.getTime())
      .sort((a, b) => a.prepDeadline.getTime() - b.prepDeadline.getTime() || a.id - b.id).map((p) => Pool.restore(p));
  }

  async upsert(pool: Pool): Promise<void> { this.db.pools.set(pool.id, pool.snapshot()); }
}

@Injectable()
export class MemoryRideTicketRepository extends RideTicketRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async find(wallet: string, poolId: number): Promise<RideTicket | null> {
    const t = this.db.tickets.get(`${wallet}|${poolId}`);
    return t ? RideTicket.restore(t) : null;
  }

  async listByWallet(wallet: string): Promise<RideTicket[]> {
    return [...this.db.tickets.values()].filter((t) => t.wallet === wallet).sort((a, b) => a.poolId - b.poolId).map((t) => RideTicket.restore(t));
  }

  async open(wallet: string, poolId: number): Promise<RideTicket> {
    const key = `${wallet}|${poolId}`;
    if (!this.db.tickets.has(key)) this.db.tickets.set(key, RideTicket.open(wallet, poolId).snapshot());
    return RideTicket.restore(this.db.tickets.get(key)!);
  }

  async save(ticket: RideTicket): Promise<RideTicket> {
    const s = ticket.snapshot();
    const key = `${s.wallet}|${s.poolId}`;
    if (this.db.tickets.get(key)?.version !== s.version) throw new VersionConflictError();
    const next = { ...s, version: s.version + 1 };
    this.db.tickets.set(key, next);
    return RideTicket.restore(next);
  }

  async appendGrant(grant: TicketGrantProps): Promise<void> { this.db.grants.push({ ...grant }); }

  async recentGrants(wallet: string, limit: number): Promise<TicketGrantProps[]> {
    return this.db.grants.map((g, i) => ({ g, i })).filter(({ g }) => g.wallet === wallet)
      .sort((a, b) => b.g.at.getTime() - a.g.at.getTime() || b.i - a.i).slice(0, limit).map(({ g }) => ({ ...g }));
  }

  async voidAllOfPool(poolId: number, now: Date): Promise<number> {
    let voided = 0;
    for (const [key, t] of [...this.db.tickets].sort(([a], [b]) => a.localeCompare(b))) {
      if (t.poolId !== poolId || t.balance <= 0) continue;
      voided += t.balance;
      this.db.grants.push({ wallet: t.wallet, poolId, delta: -t.balance, source: 'void', ref: `pool ${poolId}`, at: now });
      this.db.tickets.set(key, { ...t, balance: 0, version: t.version + 1 });
    }
    return voided;
  }
}

@Injectable()
export class MemoryPromoRepository extends PromoRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async findByCode(code: string): Promise<PromoCode | null> {
    const p = this.db.promos.get(code);
    return p ? PromoCode.restore(p) : null;
  }

  async insert(promo: PromoCode): Promise<boolean> {
    if (this.db.promos.has(promo.code)) return false;
    this.db.promos.set(promo.code, promo.snapshot());
    return true;
  }

  async list(): Promise<PromoCode[]> {
    return [...this.db.promos.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.code.localeCompare(b.code)).map((p) => PromoCode.restore(p));
  }

  async disable(code: string, now: Date): Promise<boolean> {
    const p = this.db.promos.get(code);
    if (!p) return false;
    if (!p.disabledAt) this.db.promos.set(code, { ...p, disabledAt: now });
    return true;
  }

  async takeRedemption(code: string, now: Date): Promise<boolean> {
    const p = this.db.promos.get(code);
    if (!p || p.disabledAt || (p.expiresAt && p.expiresAt.getTime() <= now.getTime()) || (p.maxRedemptions !== null && p.redeemed >= p.maxRedemptions)) return false;
    this.db.promos.set(code, { ...p, redeemed: p.redeemed + 1 });
    return true;
  }

  async insertRedemption(code: string, wallet: string, n: number, now: Date): Promise<boolean> {
    const key = `${code}|${wallet}|${n}`;
    if (this.db.redemptions.has(key)) return false;
    this.db.redemptions.set(key, now);
    return true;
  }

  async countRedemptions(code: string, wallet: string): Promise<number> {
    return [...this.db.redemptions.keys()].filter((k) => k.startsWith(`${code}|${wallet}|`)).length;
  }
}
