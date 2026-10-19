import { paymentRejectCode } from '../../../../src/domain/economy/payment-reject-code.js';

describe('paymentRejectCode', () => {
  it('maps only the verifyPayment strings', () => {
    expect(paymentRejectCode('no transfer of the ordered amount from your wallet to the treasury')).toBe('amount');
    expect(paymentRejectCode('the memo does not match this ride')).toBe('memo');
    expect(paymentRejectCode('the reference key is missing')).toBe('reference');
    expect(paymentRejectCode('not signed by your wallet')).toBe('signer');
    expect(paymentRejectCode('transaction failed on chain')).toBe('chain_failed');
    expect(paymentRejectCode('transaction has no metadata')).toBe('no_metadata');
    expect(paymentRejectCode('this ride is already paid')).toBeNull();
    expect(paymentRejectCode('ride is created')).toBeNull();
  });
});
