/** The five `verifyPayment` strings, and no others. A conflict is not in this map. */
const CODES: Readonly<Record<string, string>> = {
  'no transfer of the ordered amount from your wallet to the treasury': 'amount',
  'the memo does not match this ride': 'memo',
  'not signed by your wallet': 'signer',
  'transaction failed on chain': 'chain_failed',
  'transaction has no metadata': 'no_metadata',
};

export function paymentRejectCode(why: string): string | null {
  return CODES[why] ?? null;
}
