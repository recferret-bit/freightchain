import {
  DEFAULT_GIFT, DONATION_RENT_MIN, GIFT_ITEMS, REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH,
  bindRefusal, donationShare, inviteCapacity, invitesAvailable, isReferralCode, mintCode, qualifyDecision,
  type ReferralRecord,
} from '../../../src/domain/referral/referral-rules.js';

const knobs = { referralMax: 30, referralInviteStart: 3, referralInviteStep: 3, referralShiftsPerStep: 5 };
const row = (over: Partial<ReferralRecord> = {}): ReferralRecord => ({
  referee: 'friend', referrer: 'host', status: 'pending', boundAt: new Date(0), expiresAt: new Date(14 * 86_400_000),
  qualifiedAt: null, rideId: null, freeGranted: false, badgeCounted: false, ...over,
});
const share = (over: Partial<Parameters<typeof donationShare>[0]> = {}) => donationShare({
  price: 10_000_000, bps: 1000, already: 0, cap: 500_000_000, rentMin: DONATION_RENT_MIN, spectatorIsReferrer: false, ...over,
});

describe('referral rules', () => {
  it('mints an 8-character code from the unambiguous alphabet', () => {
    const code = mintCode('00ff10ab');
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    expect(isReferralCode(code)).toBe(true);
    for (const ch of code) expect(REFERRAL_CODE_ALPHABET).toContain(ch);
    for (const bad of ['IIIIIIII', 'OOOOOOOO', '00000000', '11111111', 'ABCD234', 'abcd2345', 'ABCD234!']) expect(isReferralCode(bad)).toBe(false);
  });

  it('invite capacity grows with verified paid shifts and stops at the max', () => {
    expect(inviteCapacity(knobs, 0)).toBe(3);
    expect(inviteCapacity(knobs, 4)).toBe(3);
    expect(inviteCapacity(knobs, 5)).toBe(6);
    expect(inviteCapacity(knobs, 9)).toBe(6);
    expect(inviteCapacity(knobs, 10)).toBe(9);
    expect(inviteCapacity(knobs, 10_000)).toBe(30);
    expect(invitesAvailable(3, 1, 1)).toBe(1);
    expect(invitesAvailable(3, 2, 2)).toBe(0);
  });

  it('refuses a bind, and a repeat of the same live code is allowed even with no slots left', () => {
    const base = { known: true, referee: 'friend', referrer: 'host', existing: null, available: 1, started: false };
    expect(bindRefusal(base)).toBeNull();
    expect(bindRefusal({ ...base, known: false, referrer: null })).toBe('unknown_code');
    expect(bindRefusal({ ...base, referee: 'host', referrer: 'host' })).toBe('own_code');
    expect(bindRefusal({ ...base, existing: row({ status: 'expired' }) })).toBe('expired');
    expect(bindRefusal({ ...base, existing: row({ referrer: 'other' }) })).toBe('already_bound');
    expect(bindRefusal({ ...base, available: 0 })).toBe('no_slots');
    expect(bindRefusal({ ...base, started: true })).toBe('ride_started');
    expect(bindRefusal({ ...base, existing: row(), available: 0, started: true })).toBeNull();
  });

  it('the first verified finish qualifies; free rides are the MEDIUM run inside the window; the badge is a paid shift or HARD with assist off', () => {
    const now = new Date(86_400_000);
    const base = {
      status: 'pending' as const, now, expiresAt: new Date(now.getTime() + 86_400_000), boundAt: new Date(0),
      alreadyFreeGranted: false, alreadyBadge: false, paid: false, level: 2 as number | null, assist: false,
      windowDays: 7, weeklyGranted: 0, weeklyCap: 10, freeReferrer: 2, freeReferee: 3,
    };
    expect(qualifyDecision(base)).toEqual({ qualify: true, freeRides: { referrer: 2, referee: 3 }, badge: false, colour: true });
    expect(qualifyDecision({ ...base, paid: true, level: null }).badge).toBe(true);
    expect(qualifyDecision({ ...base, paid: true, level: null }).freeRides).toBeNull();
    expect(qualifyDecision({ ...base, level: 3 }).badge).toBe(true);
    expect(qualifyDecision({ ...base, level: 3, assist: true }).badge).toBe(false);
    expect(qualifyDecision({ ...base, now: new Date(8 * 86_400_000), expiresAt: new Date(20 * 86_400_000) })).toMatchObject({ qualify: true, freeRides: null });
    expect(qualifyDecision({ ...base, weeklyGranted: 10 }).freeRides).toBeNull();
    expect(qualifyDecision({ ...base, freeReferrer: 0, freeReferee: 0 }).freeRides).toBeNull();
    expect(qualifyDecision({ ...base, now: new Date(20 * 86_400_000), expiresAt: new Date(14 * 86_400_000) })).toEqual({ qualify: false, freeRides: null, badge: false, colour: false });
    expect(qualifyDecision({ ...base, status: 'qualified', alreadyFreeGranted: true, paid: true }).qualify).toBe(false);
    expect(qualifyDecision({ ...base, status: 'qualified', paid: true, alreadyBadge: false }).badge).toBe(true);
    expect(DEFAULT_GIFT).toBe('convoy');
    expect(GIFT_ITEMS).toEqual(['convoy', 'signal', 'amber']);
  });

  it('a donation share is a floored cut that can pay rent and still leaves the driver something', () => {
    expect(share()).toBe(1_000_000);
    expect(share({ spectatorIsReferrer: true })).toBe(0);
    expect(share({ bps: 0 })).toBe(0);
    expect(share({ price: 1_000_000 })).toBe(0); // 10% is below the rent-exempt minimum
    expect(share({ already: 500_000_000 })).toBe(0);
    expect(share({ already: 499_500_000, cap: 500_000_000 })).toBe(0); // room 500_000 is below rent
    expect(share({ cap: 900_000 })).toBe(900_000);
  });
});
