import { reviewOf } from '../../../src/domain/verdict/ride-review.js';

/* Every completed PAID ride is reviewed before it can win money: accepted when verified (by the checks or an admin), rejected only by an admin's hand,
   UNDER REVIEW otherwise – a machine reject included. Free rides and rides that did not complete have no review. */
describe('reviewOf', () => {
  const v = (status: string, overridden = false) => ({ status, overridden });

  it('free rides have no review, whatever their verdict', () => {
    for (const verdict of [null, v('verified'), v('flagged'), v('rejected'), v('rejected', true)]) expect(reviewOf('free', verdict, 'completed')).toBeNull();
  });

  it('a paid ride that did not complete has nothing to review', () => {
    for (const status of ['created', 'awaiting_payment', 'running', 'abandoned', 'failed', 'expired', 'cancelled']) expect(reviewOf('1h', null, status)).toBeNull();
  });

  it('a completed paid ride: no verdict → under review; verified → accepted (machine or admin)', () => {
    expect(reviewOf('1h', null, 'completed')).toBe('under_review');
    expect(reviewOf('4h', v('verified'), 'completed')).toBe('accepted');
    expect(reviewOf('8h', v('verified', true), 'completed')).toBe('accepted');
  });

  it('flagged, pending and a MACHINE reject stay under review – only an admin\'s reject is final', () => {
    expect(reviewOf('1h', v('flagged'), 'completed')).toBe('under_review');
    expect(reviewOf('1h', v('pending'), 'completed')).toBe('under_review');
    expect(reviewOf('1h', v('rejected'), 'completed')).toBe('under_review');
    expect(reviewOf('1h', v('rejected', true), 'completed')).toBe('rejected');
  });
});
