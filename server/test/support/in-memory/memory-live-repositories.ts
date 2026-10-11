import { RideEventRepositoryPort } from '../../../src/application/ports/live/ride-event.repository.port.js';
import { RideMuteRepositoryPort } from '../../../src/application/ports/live/ride-mute.repository.port.js';
import { DonationOrderRepositoryPort } from '../../../src/application/ports/live/donation-order.repository.port.js';
import { DonationOrder } from '../../../src/domain/live/donation-order.entity.js';
import type { LiveTotalsByRide } from '../../../src/domain/live/live.dto.js';
import { RideEvent } from '../../../src/domain/live/ride-event.entity.js';
import type { MemoryDb } from './memory-db.js';

/** The live feed's in-memory twin: the same unique (rideId, slotKey, slot) window and first-stamp-wins rules as live.RideEvent. */
export class MemoryRideEventRepository extends RideEventRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async insert(event: RideEvent, minGapMs?: number): Promise<RideEvent | null> {
    const p = event.snapshot();
    if (p.signature && this.db.rideEvents.some((e) => e.signature === p.signature)) return null;   // the unique signature
    if (this.db.rideEvents.some((e) => e.rideId === p.rideId && e.slotKey === p.slotKey && e.slot === p.slot)) return null;
    const last = await this.lastOf(p.rideId, p.slotKey);
    if (minGapMs !== undefined && last && p.createdAt.getTime() - last.getTime() < minGapMs) return null;
    const stored = { ...p, id: this.db.nextSeq() };
    this.db.rideEvents.push(stored);
    return RideEvent.restore(stored);
  }

  private async lastOf(rideId: string, slotKey: string): Promise<Date | null> {
    const times = this.db.rideEvents.filter((e) => e.rideId === rideId && e.slotKey === slotKey).map((e) => e.createdAt.getTime());
    return times.length ? new Date(Math.max(...times)) : null;
  }

  async findBySignature(signature: string): Promise<RideEvent | null> {
    const row = this.db.rideEvents.find((e) => e.signature === signature);
    return row ? RideEvent.restore(row) : null;
  }

  lastEffectAt(rideId: string): Promise<Date | null> {
    return this.lastOf(rideId, 'fx');
  }

  async listAppliedSince(rideId: string, since: Date, limit: number): Promise<RideEvent[]> {
    return this.db.rideEvents.filter((e) => e.rideId === rideId && e.applied && e.applied.at.getTime() > since.getTime())
      .sort((a, b) => a.applied!.at.getTime() - b.applied!.at.getTime()).slice(0, limit).map((e) => RideEvent.restore(e));
  }

  async findById(id: number): Promise<RideEvent | null> {
    const row = this.db.rideEvents.find((e) => e.id === id);
    return row ? RideEvent.restore(row) : null;
  }

  async saveApplied(event: RideEvent): Promise<boolean> {
    const row = this.db.rideEvents.find((e) => e.id === event.id);
    if (!row || row.applied || !event.applied) return false;
    row.applied = { ...event.applied };
    return true;
  }

  async listAfter(rideId: string, afterId: number, limit: number): Promise<RideEvent[]> {
    return this.db.rideEvents.filter((e) => e.rideId === rideId && (e.id ?? 0) > afterId).slice(0, limit).map((e) => RideEvent.restore(e));
  }

  async totals(rideId: string): Promise<LiveTotalsByRide> {
    const mine = this.db.rideEvents.filter((e) => e.rideId === rideId), gifts = mine.filter((e) => e.kind === 'donation');
    return { messages: mine.length - gifts.length, donations: gifts.length, lamports: gifts.reduce((a, e) => a + e.lamports, 0) };
  }
}

/** RideMute's in-memory twin: a set of `${rideId}|${wallet}`. */
export class MemoryRideMuteRepository extends RideMuteRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async set(rideId: string, wallet: string, muted: boolean, _now?: Date): Promise<boolean> {
    const key = `${rideId}|${wallet}`, had = this.db.rideMutes.has(key);
    if (muted) this.db.rideMutes.add(key); else this.db.rideMutes.delete(key);
    return had !== muted;
  }

  async isMuted(rideId: string, wallet: string): Promise<boolean> { return this.db.rideMutes.has(`${rideId}|${wallet}`); }

  async list(rideId: string): Promise<Set<string>> {
    return new Set([...this.db.rideMutes].filter((k) => k.startsWith(`${rideId}|`)).map((k) => k.slice(rideId.length + 1)));
  }
}

/** DonationOrder's in-memory twin: the same conditional claim and unique signature. */
export class MemoryDonationOrderRepository extends DonationOrderRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async insert(order: DonationOrder): Promise<void> { this.db.donationOrders.set(order.id, order.snapshot()); }

  async findById(id: string): Promise<DonationOrder | null> {
    const p = this.db.donationOrders.get(id);
    return p ? DonationOrder.restore(p) : null;
  }

  async claim(id: string, signature: string, now: Date): Promise<boolean> {
    const p = this.db.donationOrders.get(id);
    if (!p || p.status !== 'pending' || [...this.db.donationOrders.values()].some((o) => o.signature === signature)) return false;
    Object.assign(p, { status: 'paid', signature, paidAt: now });
    return true;
  }

  async setEvent(id: string, eventId: number): Promise<void> {
    const p = this.db.donationOrders.get(id);
    if (p) p.eventId = eventId;
  }

  async setReference(id: string, reference: string): Promise<void> {
    const p = this.db.donationOrders.get(id);
    if (p && !p.paymentReference) p.paymentReference = reference;
  }
}
