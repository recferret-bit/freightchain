import { Injectable } from '@nestjs/common';
import { Pool } from '../../../src/domain/economy/pool.entity.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';
import { PromoCode } from '../../../src/domain/economy/promo-code.entity.js';
import { TicketOrder } from '../../../src/domain/economy/ticket-order.entity.js';
import { TicketOrderRepositoryPort } from '../../../src/application/ports/economy/ticket-order.repository.port.js';
import { RideTicket } from '../../../src/domain/players/ride-ticket.entity.js';
import type { TicketGrantProps } from '../../../src/domain/players/ride-ticket.types.js';
import type { PaidTierId } from '../../../src/domain/rides/ride-tier.js';
import { VersionConflictError } from '../../../src/domain/shared/errors.js';
import { PoolRepositoryPort } from '../../../src/application/ports/economy/pool.repository.port.js';
import { PromoRepositoryPort, type PromoRedemptionRecord } from '../../../src/application/ports/economy/promo.repository.port.js';
import { CosmeticRepositoryPort, type CosmeticUnlockRecord } from '../../../src/application/ports/players/cosmetic.repository.port.js';
import type { CosmeticSlot } from '../../../src/domain/economy/cosmetics.js';
import { RideTicketRepositoryPort } from '../../../src/application/ports/players/ride-ticket.repository.port.js';
import type { MemoryDb } from './memory-db.js';

/* In-memory twins of the pool / ticket / promo / order repositories (same contracts as the Prisma ones; see memory-repositories.ts). */

const soonest = (a: PoolProps, b: PoolProps) => a.playDeadline.getTime() - b.playDeadline.getTime() || a.id - b.id;
const isLive = (p: PoolProps) => p.status === 'open' || p.status === 'active';

@Injectable()
export class MemoryPoolRepository extends PoolRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async findById(id: number): Promise<Pool | null> {
    const p = this.db.pools.get(id);
    return p ? Pool.restore(p) : null;
  }

  async findByAddress(address: string): Promise<Pool | null> {
    const p = [...this.db.pools.values()].find((x) => x.address === address);
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

  async upsert(pool: Pool): Promise<void> { const had = this.db.pools.get(pool.id); this.db.pools.set(pool.id, { ...pool.snapshot(), rideSeed: had?.rideSeed ?? pool.rideSeed }); } // the ride seed is set once, like the Prisma upsert
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
    if (!p || p.disabledAt || p.startsAt.getTime() > now.getTime() || (p.expiresAt && p.expiresAt.getTime() <= now.getTime()) || (p.maxRedemptions !== null && p.redeemed >= p.maxRedemptions)) return false;
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

  async listRedemptions({ code, wallet, limit }: { code?: string; wallet?: string; limit: number }): Promise<PromoRedemptionRecord[]> {
    return [...this.db.redemptions.entries()]
      .map(([key, at]) => { const [c, w, n] = key.split('|') as [string, string, string]; return { code: c, wallet: w, n: Number(n), at }; })
      .filter((r) => (!code || r.code === code) && (!wallet || r.wallet === wallet))
      .sort((a, b) => b.at.getTime() - a.at.getTime() || a.code.localeCompare(b.code) || b.n - a.n)
      .slice(0, limit);
  }
}

@Injectable()
export class MemoryCosmeticRepository extends CosmeticRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async unlock(r: CosmeticUnlockRecord): Promise<boolean> {
    const key = `${r.wallet}|${r.slot}|${r.item}`;
    if (this.db.cosmeticUnlocks.has(key)) return false;
    this.db.cosmeticUnlocks.set(key, { ...r });
    return true;
  }

  async has(wallet: string, slot: CosmeticSlot, item: string): Promise<boolean> { return this.db.cosmeticUnlocks.has(`${wallet}|${slot}|${item}`); }

  async listUnlocked(wallet: string): Promise<CosmeticUnlockRecord[]> {
    return [...this.db.cosmeticUnlocks.values()].filter((r) => r.wallet === wallet).sort((a, b) => a.at.getTime() - b.at.getTime() || a.slot.localeCompare(b.slot) || a.item.localeCompare(b.item));
  }

  async equip(wallet: string, slot: CosmeticSlot, item: string): Promise<void> { this.db.cosmeticEquipped.set(`${wallet}|${slot}`, item); }

  async listEquipped(wallet: string): Promise<Partial<Record<CosmeticSlot, string>>> {
    const out: Partial<Record<CosmeticSlot, string>> = {};
    for (const [key, item] of this.db.cosmeticEquipped) { const [w, slot] = key.split('|') as [string, CosmeticSlot]; if (w === wallet) out[slot] = item; }
    return out;
  }
}

@Injectable()
export class MemoryTicketOrderRepository extends TicketOrderRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async insert(order: TicketOrder): Promise<void> {
    const s = order.snapshot();
    if (this.db.orders.has(s.id) || (s.signature && this.bySettlement(s.signature, s.eventIndex))) throw new Error('unique violation');
    this.db.orders.set(s.id, s);
  }

  async findById(id: string): Promise<TicketOrder | null> {
    const o = this.db.orders.get(id);
    return o ? TicketOrder.restore(o) : null;
  }

  async findBySettlement(signature: string, eventIndex: number): Promise<TicketOrder | null> {
    const o = this.bySettlement(signature, eventIndex);
    return o ? TicketOrder.restore(o) : null;
  }

  async findAwaitingByWallet(wallet: string): Promise<TicketOrder | null> {
    const o = [...this.db.orders.values()].filter((x) => x.wallet === wallet && x.status === 'awaiting_payment')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0];
    return o ? TicketOrder.restore(o) : null;
  }

  async listPaid(wallet: string, poolId: number): Promise<TicketOrder[]> {
    return [...this.db.orders.values()].filter((x) => x.wallet === wallet && x.poolId === poolId && x.status === 'paid')
      .sort((a, b) => (a.paidAt?.getTime() ?? 0) - (b.paidAt?.getTime() ?? 0) || a.id.localeCompare(b.id)).map((o) => TicketOrder.restore(o));
  }

  async save(order: TicketOrder): Promise<void> {
    const s = order.snapshot();
    const clash = s.signature ? this.bySettlement(s.signature, s.eventIndex) : undefined;
    if (clash && clash.id !== s.id) throw new Error('unique violation');
    this.db.orders.set(s.id, s);
  }

  async totalsOf(wallet: string): Promise<{ lamports: number; tickets: number }> {
    const paid = [...this.db.orders.values()].filter((x) => x.wallet === wallet && x.status === 'paid');
    return { lamports: paid.reduce((n, o) => n + o.lamports, 0), tickets: paid.reduce((n, o) => n + o.qty, 0) };
  }

  private bySettlement(signature: string, eventIndex: number | null) {
    return [...this.db.orders.values()].find((x) => x.signature === signature && x.eventIndex === eventIndex);
  }
}
