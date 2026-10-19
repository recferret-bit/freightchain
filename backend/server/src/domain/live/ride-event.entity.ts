import { BadRequestError } from '../shared/errors.js';
import {
  APPLIED_MAX_LAT, APPLIED_MAX_S, EFFECTS, EFFECT_WINDOW_MS, LINE_WINDOW_MS, MESSAGE_MAX_LENGTH, NOTE_MAX_LENGTH, type EffectId,
} from './live-rules.js';

export type RideEventKind = 'message' | 'donation' | 'honk';

/** Where and when the driver's game applied an effect: game time (driven seconds), road position s, and across the road (obstacles).
    An obstacle stamped with lat null was MISSED: the driver's game found no room for it (junctions / lane changes ahead) – it is not on the road. */
export interface EffectApplied {
  at: Date;
  t: number;
  s: number;
  lat: number | null;
}

export interface RideEventProps {
  /** null until stored (the database numbers the feed) */
  id: number | null;
  rideId: string;
  wallet: string;
  kind: RideEventKind;
  text: string | null;
  effect: EffectId | 'snow' | 'clear' | null;
  lamports: number;
  /** the rate-limit window this line took: unique per (rideId, slotKey, slot) */
  slotKey: string;
  slot: number;
  createdAt: Date;
  applied: EffectApplied | null;
  /** a PAID donation's transfer (LIVE_FREE_DONATIONS=off); null = a mock donation, a chat line, or a honk time change */
  signature: string | null;
}

/** A donation that was paid on chain: its order (a unique rate-limit key, so a paid tip never collides with a bucket), the transfer, the amount paid. */
export interface PaidWith {
  orderId: string;
  signature: string;
  lamports: number;
}

/** Spectator text as it will be shown: control characters out, whitespace collapsed, trimmed. The clients render it as text, never as HTML. */
export function cleanText(raw: string): string {
  // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
  return raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
}

const windowOf = (now: Date, ms: number): number => Math.floor(now.getTime() / ms);

/** One line in a ride's live feed. Created by a spectator (never the driver), stamped once by the driver's game when it applied the effect. */
export class RideEvent {
  private constructor(private readonly p: RideEventProps) {}

  static message(i: { rideId: string; wallet: string; text: string; now: Date }): RideEvent {
    const text = cleanText(i.text);
    if (!text) throw new BadRequestError('the message is empty', 'bad_message');
    if (text.length > MESSAGE_MAX_LENGTH) throw new BadRequestError(`a message is at most ${MESSAGE_MAX_LENGTH} characters`, 'bad_message');
    return new RideEvent({
      id: null, rideId: i.rideId, wallet: i.wallet, kind: 'message', text, effect: null, lamports: 0,
      slotKey: `msg:${i.wallet}`, slot: windowOf(i.now, LINE_WINDOW_MS), createdAt: i.now, applied: null, signature: null,
    });
  }

  /** A MOCK donation: priced from EFFECTS, nothing is charged. A game effect takes the ride's one effect window; a tip only the wallet's line window. */
  static donation(i: { rideId: string; wallet: string; effect: EffectId; note?: string | null; now: Date; paid?: PaidWith }): RideEvent {
    const note = i.note ? cleanText(i.note) : '';
    if (note.length > NOTE_MAX_LENGTH) throw new BadRequestError(`a donation note is at most ${NOTE_MAX_LENGTH} characters`, 'bad_message');
    const rule = EFFECTS[i.effect];
    const slotKey = rule.game ? 'fx' : i.paid ? `paid:${i.paid.orderId}` : `tip:${i.wallet}`;   // a paid tip is never refused: the money already moved
    return new RideEvent({
      id: null, rideId: i.rideId, wallet: i.wallet, kind: 'donation', text: note || null, effect: i.effect, lamports: i.paid?.lamports ?? rule.lamports,
      slotKey, slot: rule.game ? windowOf(i.now, EFFECT_WINDOW_MS) : i.paid ? 0 : windowOf(i.now, LINE_WINDOW_MS), createdAt: i.now, applied: null, signature: i.paid?.signature ?? null,
    });
  }

  /** A burned day or night change. Lamports stay 0 so it is not a donation and the stats path does not count it. Night and day are game effects, so the driver can stamp it. */
  static honkPhase(i: { rideId: string; wallet: string; phase: 'day' | 'night'; text: string; now: Date }): RideEvent {
    return new RideEvent({
      id: null, rideId: i.rideId, wallet: i.wallet, kind: 'honk', text: i.text, effect: i.phase, lamports: 0,
      slotKey: 'fx', slot: windowOf(i.now, EFFECT_WINDOW_MS), createdAt: i.now, applied: null, signature: null,
    });
  }

  /** A burned snow or clear change. Lamports stay 0 so it is not a donation. Snow and clear are not donation effects; they still take the effect window so the driver can stamp them. */
  static honkWeather(i: { rideId: string; wallet: string; weather: 'snow' | 'clear'; text: string; now: Date }): RideEvent {
    return new RideEvent({
      id: null, rideId: i.rideId, wallet: i.wallet, kind: 'honk', text: i.text, effect: i.weather, lamports: 0,
      slotKey: 'fx', slot: windowOf(i.now, EFFECT_WINDOW_MS), createdAt: i.now, applied: null, signature: null,
    });
  }

  static restore(props: RideEventProps): RideEvent {
    return new RideEvent({ ...props, applied: props.applied ? { ...props.applied } : null });
  }

  /** ms until this line's rate-limit window is over (the Retry-After of a refused post) */
  static retryAfterMs(slotKey: string, now: Date): number {
    const ms = slotKey === 'fx' ? EFFECT_WINDOW_MS : LINE_WINDOW_MS;
    return ms - (now.getTime() % ms);
  }

  get id(): number | null { return this.p.id; }
  get rideId(): string { return this.p.rideId; }
  get wallet(): string { return this.p.wallet; }
  get kind(): RideEventKind { return this.p.kind; }
  get effect(): EffectId | 'snow' | 'clear' | null { return this.p.effect; }
  get slotKey(): string { return this.p.slotKey; }
  get applied(): EffectApplied | null { return this.p.applied; }
  get signature(): string | null { return this.p.signature; }
  /** something the driver's game has to do. Snow and clear are not donation ids; they still move the cab. */
  get needsGame(): boolean {
    const effect = this.p.effect;
    if (effect === 'snow' || effect === 'clear') return true;
    return effect !== null && EFFECTS[effect].game;
  }

  /** an obstacle the driver's game could not place (stamped as missed). Snow and clear are not obstacles. */
  get missed(): boolean {
    const effect = this.p.effect;
    if (effect === 'snow' || effect === 'clear') return false;
    return this.p.applied !== null && effect !== null && EFFECTS[effect].obstacle && this.p.applied.lat === null;
  }

  /** The driver's game applied it (or, `missed`, could not). First stamp wins (a re-sent ack changes nothing → false); only game effects take one;
      a placed obstacle needs its position across the road. */
  markApplied(report: { t: number; s: number; lat: number | null; missed?: boolean }, now: Date): boolean {
    if (!this.needsGame) throw new BadRequestError('this event has nothing to apply', 'not_an_effect');
    if (this.p.applied) return false;
    const { t, s } = report, lat = report.lat ?? null;
    if (!Number.isFinite(t) || t < 0 || !Number.isFinite(s) || s < 0 || s > APPLIED_MAX_S) throw new BadRequestError('applied at an impossible time or place', 'bad_applied');
    const effect = this.p.effect;
    const obstacle = effect !== null && effect !== 'snow' && effect !== 'clear' && EFFECTS[effect].obstacle;
    const missed = obstacle && report.missed === true;
    if (obstacle && !missed && (lat === null || !Number.isFinite(lat) || Math.abs(lat) > APPLIED_MAX_LAT)) throw new BadRequestError('an obstacle needs its place across the road', 'bad_applied');
    this.p.applied = { at: now, t, s, lat: obstacle && !missed ? lat : null };
    return true;
  }

  snapshot(): RideEventProps {
    return { ...this.p, applied: this.p.applied ? { ...this.p.applied } : null };
  }
}
