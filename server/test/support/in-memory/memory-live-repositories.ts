import { RideEventRepositoryPort } from '../../../src/application/ports/live/ride-event.repository.port.js';
import type { LiveTotalsByRide } from '../../../src/domain/live/live.dto.js';
import { RideEvent } from '../../../src/domain/live/ride-event.entity.js';
import type { MemoryDb } from './memory-db.js';

/** The live feed's in-memory twin: the same unique (rideId, slotKey, slot) window and first-stamp-wins rules as live.RideEvent. */
export class MemoryRideEventRepository extends RideEventRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async insert(event: RideEvent, minGapMs?: number): Promise<RideEvent | null> {
    const p = event.snapshot();
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
