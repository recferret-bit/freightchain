import { DonationOrder, donationSplitLanded, verifyDonation } from '../../../src/domain/live/donation-order.entity.js';
import { EFFECTS } from '../../../src/domain/live/live-rules.js';
import type { ChainTransaction } from '../../../src/domain/economy/chain-transaction.js';

const T = new Date(Date.UTC(2036, 9, 8, 12, 0, 0));
const order = DonationOrder.create({ id: 'o-1', rideId: 'r', wallet: 'fan', recipient: 'driver', effect: 'sinkhole', note: '  enjoy ', now: T });
const tx = (o: Partial<ChainTransaction> = {}): ChainTransaction => ({ outcome: 'success', feePayer: 'fan', feePayerSigned: true, transfers: [{ source: 'fan', destination: 'driver', lamports: EFFECTS.sinkhole.lamports }], memos: ['fc-donation:o-1'], ...o });

describe('DonationOrder (a paid donation in flight)', () => {
  it('is priced from EFFECTS, pays the DRIVER, and carries its own memo', () => {
    expect(order.snapshot()).toMatchObject({ status: 'pending', lamports: EFFECTS.sinkhole.lamports, recipient: 'driver', note: 'enjoy', signature: null, eventId: null });
    expect(order.memo).toBe('fc-donation:o-1');
    expect(() => DonationOrder.create({ id: 'x', rideId: 'r', wallet: 'w', recipient: 'd', effect: 'tip', note: 'n'.repeat(81), now: T })).toThrow(/at most 80/);
  });

  it('verifyDonation: the transfer must come from the spectator, to the driver, of at least the price, with the memo, signed, not failed', () => {
    expect(verifyDonation(tx(), order)).toBeNull();
    expect(verifyDonation(tx({ transfers: [{ source: 'fan', destination: 'driver', lamports: EFFECTS.sinkhole.lamports * 2 }] }), order)).toBeNull();
    expect(verifyDonation(tx({ transfers: [{ source: 'fan', destination: 'treasury', lamports: EFFECTS.sinkhole.lamports }] }), order)).toBe('no transfer of the donation from your wallet to the driver');
    expect(verifyDonation(tx({ transfers: [{ source: 'fan', destination: 'driver', lamports: 1 }] }), order)).toMatch(/no transfer/);
    expect(verifyDonation(tx({ memos: ['fc-donation:other'] }), order)).toBe('the memo does not match this donation');
    expect(verifyDonation(tx({ feePayer: 'someone' }), order)).toBe('not signed by your wallet');
    expect(verifyDonation(tx({ outcome: 'failed' }), order)).toBe('transaction failed on chain');
    expect(verifyDonation(tx({ outcome: 'no_metadata' }), order)).toBe('transaction has no metadata');
  });

  it('a reserved share must be the split; once released, the full price or a split that already landed both pay it', () => {
    const shared = DonationOrder.restore({ ...order.snapshot(), referrer: 'host', shareLamports: 1_000_000, shareState: 'reserved' });
    const price = shared.lamports;
    const split = tx({ transfers: [{ source: 'fan', destination: 'driver', lamports: price - 1_000_000 }, { source: 'fan', destination: 'host', lamports: 1_000_000 }] });
    const full = tx();
    expect(verifyDonation(split, shared)).toBeNull();
    expect(donationSplitLanded(split, shared)).toBe(true);
    expect(verifyDonation(full, shared)).toMatch(/no transfer/);
    const released = DonationOrder.restore({ ...shared.snapshot(), shareState: 'released' });
    expect(verifyDonation(full, released)).toBeNull();
    expect(verifyDonation(split, released)).toMatch(/no transfer/);
    expect(donationSplitLanded(full, released)).toBe(false);
  });
});
