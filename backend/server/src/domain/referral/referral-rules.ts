/** Invite codes, who may bind, when a friend qualifies, and how a spectator tip is split. Pure. The pot split itself is referral-split.ts. */

export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;
export const GIFT_ITEMS = ['convoy', 'signal', 'amber'] as const;
export type GiftItem = (typeof GIFT_ITEMS)[number];
export const DEFAULT_GIFT = 'convoy';
/** Rent::minimum_balance(0). A share below this cannot open an empty referrer account. */
export const DONATION_RENT_MIN = 890_880;
/** A reserved donation share older than this is released before the next reserve for that pair. */
export const DONATION_SHARE_TTL_MS = 15 * 60 * 1000;
const DAY_MS = 86_400_000;

export type ReferralStatus = 'pending' | 'qualified' | 'expired';

export interface ReferralCodeRecord {
  wallet: string;
  code: string;
  gift: string;
  createdAt: Date;
}

export interface ReferralRecord {
  referee: string;
  referrer: string;
  status: ReferralStatus;
  boundAt: Date;
  expiresAt: Date;
  qualifiedAt: Date | null;
  rideId: string | null;
  freeGranted: boolean;
  badgeCounted: boolean;
}

export type BindRefusal = 'own_code' | 'already_bound' | 'expired' | 'no_slots' | 'ride_started' | 'unknown_code';

export const isGiftItem = (v: string): v is GiftItem => (GIFT_ITEMS as readonly string[]).includes(v);
export const isReferralCode = (code: string): boolean => new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`).test(code);

/** `hex` is EntropyPort.hex(8): 16 hex chars, one byte per letter. Ambiguous glyphs are not in the alphabet. */
export function mintCode(hex: string): string {
  const bytes = hex.replace(/[^0-9a-f]/gi, '');
  let out = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) out += REFERRAL_CODE_ALPHABET[parseInt(bytes.slice(i * 2, i * 2 + 2) || '0', 16) % REFERRAL_CODE_ALPHABET.length];
  return out;
}

export function inviteCapacity(s: { referralMax: number; referralInviteStart: number; referralInviteStep: number; referralShiftsPerStep: number }, verifiedPaidShifts: number): number {
  const steps = Math.floor(Math.max(0, verifiedPaidShifts) / s.referralShiftsPerStep);
  return Math.min(s.referralMax, s.referralInviteStart + s.referralInviteStep * steps);
}

export const invitesAvailable = (capacity: number, used: number, pending: number): number => Math.max(0, capacity - used - pending);

/**
 * null = bind (or the same code again, which is a no-op). The idempotent case is decided BEFORE the slot and started-ride checks,
 * so a friend who already bound can call again after their referrer has filled up. An expired row is a tombstone: that wallet never binds again.
 */
export function bindRefusal(i: { known: boolean; referee: string; referrer: string | null; existing: ReferralRecord | null; available: number; started: boolean }): BindRefusal | null {
  if (!i.known || !i.referrer) return 'unknown_code';
  if (i.referrer === i.referee) return 'own_code';
  if (i.existing && i.existing.referrer === i.referrer && i.existing.status !== 'expired') return null;
  if (i.existing?.status === 'expired') return 'expired';
  if (i.existing) return 'already_bound';
  if (i.available <= 0) return 'no_slots';
  if (i.started) return 'ride_started';
  return null;
}

export interface QualifyInput {
  status: ReferralStatus;
  now: Date;
  expiresAt: Date;
  boundAt: Date;
  alreadyFreeGranted: boolean;
  alreadyBadge: boolean;
  /** a paid shift (any tier). A free run is not. */
  paid: boolean;
  /** free level 2 = MEDIUM, 3 = HARD; null on a paid trip */
  level: number | null;
  assist: boolean;
  windowDays: number;
  weeklyGranted: number;
  weeklyCap: number;
  freeReferrer: number;
  freeReferee: number;
}

export interface QualifyDecision {
  /** pending → qualified. An invite is spent on the first verified finish, free or paid. */
  qualify: boolean;
  /** null = no grant. A 0 on one side means grant only the other (grantFreeRides refuses a count below 1). */
  freeRides: { referrer: number; referee: number } | null;
  /** once: a verified paid shift, or the HARD free run with assist off. A later ride can set it if the first qualify was only MEDIUM. */
  badge: boolean;
  /** the referrer's gift colour, on the first qualify only */
  colour: boolean;
}

const NO_QUALIFY: QualifyDecision = { qualify: false, freeRides: null, badge: false, colour: false };

/** Expired, or a pending row whose invite window has closed, qualifies nothing. The caller marks that pending row expired. */
export function qualifyDecision(i: QualifyInput): QualifyDecision {
  if (i.status === 'expired') return NO_QUALIFY;
  if (i.status === 'pending' && i.now.getTime() > i.expiresAt.getTime()) return NO_QUALIFY;
  const first = i.status === 'pending';
  const inside = i.now.getTime() - i.boundAt.getTime() <= i.windowDays * DAY_MS;
  const grant = first && !i.alreadyFreeGranted && i.level === 2 && !i.paid && inside && i.weeklyGranted < i.weeklyCap;
  const freeRides = grant && (i.freeReferrer > 0 || i.freeReferee > 0) ? { referrer: i.freeReferrer, referee: i.freeReferee } : null;
  const badge = !i.alreadyBadge && (i.paid || (i.level === 3 && !i.assist));
  return { qualify: first, freeRides, badge, colour: first };
}

/**
 * Lamports of `price` that go to the referrer. 0 = one transfer of the whole price to the driver (no share, the spectator IS the referrer,
 * the share could not pay rent, or the driver would receive nothing).
 */
export function donationShare(i: { price: number; bps: number; already: number; cap: number; rentMin: number; spectatorIsReferrer: boolean }): number {
  if (i.spectatorIsReferrer || i.bps <= 0 || i.cap <= 0 || i.price <= 0) return 0;
  const room = Math.max(0, i.cap - Math.max(0, i.already));
  const share = Math.min(Math.floor((i.price * i.bps) / 10_000), room);
  if (share < i.rentMin || i.price - share <= 0) return 0;
  return share;
}
