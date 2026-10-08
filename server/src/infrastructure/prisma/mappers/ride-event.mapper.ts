import type { RideEvent as RideEventRow } from '@prisma/client';
import { RideEvent, type RideEventKind } from '../../../domain/live/ride-event.entity.js';
import { isEffectId } from '../../../domain/live/live-rules.js';

/** Row ⇄ entity. lamports are BigInt in the table (like every amount), plain numbers in the domain (mock amounts are far below 2^53). */
export class RideEventMapper {
  static toDomain(row: RideEventRow): RideEvent {
    return RideEvent.restore({
      id: row.id, rideId: row.rideId, wallet: row.wallet, kind: row.kind as RideEventKind, text: row.text, effect: isEffectId(row.effect) ? row.effect : null,
      lamports: Number(row.lamports), slotKey: row.slotKey, slot: row.slot, createdAt: row.createdAt,
      applied: row.appliedAt && row.appliedT !== null && row.appliedS !== null ? { at: row.appliedAt, t: row.appliedT, s: row.appliedS, lat: row.appliedLat } : null,
      signature: row.signature,
    });
  }

  static toCreateData(event: RideEvent) {
    const p = event.snapshot();
    return {
      rideId: p.rideId, wallet: p.wallet, kind: p.kind, text: p.text, effect: p.effect, lamports: BigInt(p.lamports), slotKey: p.slotKey, slot: p.slot, createdAt: p.createdAt,
      appliedAt: p.applied?.at ?? null, appliedT: p.applied?.t ?? null, appliedS: p.applied?.s ?? null, appliedLat: p.applied?.lat ?? null, signature: p.signature,
    };
  }
}
