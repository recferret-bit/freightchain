import { splitPool, lamportsFor } from '../../../src/domain/economy/prize-split.js';
import { Round, RoundStatus } from '../../../src/domain/economy/round.entity.js';
import { weekBounds } from '../../../src/domain/economy/week.js';
import { memoMentions, verifyPayment } from '../../../src/domain/economy/payment-verification.js';
import type { ChainTransaction } from '../../../src/domain/economy/chain-transaction.js';
import { isTransactionSignature } from '../../../src/domain/economy/transaction-signature.js';

describe('splitPool', () => {
  it('shares always sum to the entries exactly (floors, remainder to fees)', () => {
    for (let i = 0; i < 2000; i++) {
      const entries = Math.floor(Math.random() * 1e12) + (i % 7), carry = Math.floor(Math.random() * 1e9), s = splitPool(entries, carry);
      expect(s.grand - carry + s.top20 + s.nextSeed + s.fees).toBe(entries);
      expect(s.fees).toBeGreaterThanOrEqual(Math.floor(entries * 0.1));
    }
  });
  it('50 / 20 / 20 / 10 of a round number', () => expect(splitPool(1_000_000_000, 5)).toEqual({ entries: 1e9, carry: 5, grand: 5e8 + 5, top20: 2e8, nextSeed: 2e8, fees: 1e8 }));
});

describe('weekBounds / lamportsFor', () => {
  const mon = Date.UTC(2026, 9, 5);
  it('weeks run Monday 00:00 UTC → Monday', () => {
    expect(weekBounds(new Date(Date.UTC(2026, 9, 7, 12)))).toEqual({ start: new Date(mon), end: new Date(mon + 7 * 86_400_000) });
    expect(weekBounds(new Date(mon)).start.getTime()).toBe(mon);
    expect(weekBounds(new Date(mon + 7 * 86_400_000 - 1)).start.getTime()).toBe(mon);
    expect(weekBounds(new Date(Date.UTC(2026, 9, 11, 23, 59))).start.getTime()).toBe(mon); // Sunday
  });
  it('rounds the price UP to 1000 lamports', () => { expect(lamportsFor(5, 100)).toBe(50_000_000); expect(lamportsFor(5, 118.105)).toBe(42_336_000); });
});

describe('Round', () => {
  const wed = new Date(Date.UTC(2026, 9, 7, 12));
  it('opens for the week containing now, seeded with the carry', () => {
    const r = Round.open(wed, 123);
    expect(r.snapshot()).toMatchObject({ id: null, carry: 123, status: RoundStatus.Open, startsAt: new Date(Date.UTC(2026, 9, 5)), endsAt: new Date(Date.UTC(2026, 9, 12)) });
    expect(r.contains(wed)).toBe(true);
    expect(r.contains(new Date(Date.UTC(2026, 9, 12)))).toBe(false); // end is exclusive
    expect(() => r.id).toThrow('not persisted');
  });
  it('hands 20 % to the next week – and its own carry on when nobody entered', () => {
    const r = Round.restore({ id: 1, startsAt: wed, endsAt: wed, carry: 700, status: RoundStatus.Open });
    expect(r.carryOver(1_000_000, 4)).toBe(200_000);
    expect(r.carryOver(0, 0)).toBe(700);
  });
});

describe('verifyPayment', () => {
  const ok: ChainTransaction = { outcome: 'success', feePayer: 'W', feePayerSigned: true, transfers: [{ source: 'W', destination: 'T', lamports: 100 }], memos: ['ride-1'] };
  const expected = { wallet: 'W', treasury: 'T', lamports: 100, memo: 'ride-1' };
  const why = (over: Partial<ChainTransaction>, exp = expected) => verifyPayment({ ...ok, ...over }, exp);

  it('accepts the ordered amount, or more, with extra transfers / memos around it', () => {
    expect(why({})).toBeNull();
    expect(why({ transfers: [{ source: 'W', destination: 'T', lamports: 101 }] })).toBeNull();
    expect(why({ transfers: [{ source: 'W', destination: 'X', lamports: 1 }, ...ok.transfers], memos: ['noise', 'ride-1'] })).toBeNull();
  });
  it.each([
    ['no metadata', { outcome: 'no_metadata' as const }, 'transaction has no metadata'],
    ['failed on chain', { outcome: 'failed' as const }, 'transaction failed on chain'],
    ['paid by someone else', { feePayer: 'EVE' }, 'not signed by your wallet'],
    ['fee payer did not sign', { feePayerSigned: false }, 'not signed by your wallet'],
    ['too little', { transfers: [{ source: 'W', destination: 'T', lamports: 99 }] }, 'no transfer of the ordered amount from your wallet to the treasury'],
    ['wrong destination', { transfers: [{ source: 'W', destination: 'X', lamports: 100 }] }, 'no transfer of the ordered amount from your wallet to the treasury'],
    ['wrong source', { transfers: [{ source: 'EVE', destination: 'T', lamports: 100 }] }, 'no transfer of the ordered amount from your wallet to the treasury'],
    ['wrong memo', { memos: ['ride-2'] }, 'the memo does not match this ride'],
    ['no memo', { memos: [] }, 'the memo does not match this ride'],
  ])('rejects: %s', (_n, over, reason) => expect(why(over)).toBe(reason));
});

describe('memoMentions / isTransactionSignature', () => {
  it('matches the RPC rendering "[len] text"', () => {
    expect(memoMentions('[36] 0b6f7a2e-1111-2222-3333-444455556666', '0b6f7a2e-1111-2222-3333-444455556666')).toBe(true);
    expect(memoMentions('[5] hello', 'ride')).toBe(false);
    expect(memoMentions(null, 'ride')).toBe(false);
  });
  it('a signature is base58 of 64 bytes', () => {
    expect(isTransactionSignature('5'.repeat(88))).toBe(true);
    expect(isTransactionSignature('0OIl'.repeat(22))).toBe(false); // not base58
    expect(isTransactionSignature('short')).toBe(false);
    expect(isTransactionSignature(42)).toBe(false);
  });
});
