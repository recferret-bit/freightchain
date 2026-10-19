import bs58 from 'bs58';

export const TRANSACTION_SIGNATURE_MESSAGE = 'signature must be a base58 transaction signature';

/** A Solana transaction signature is the base58 form of 64 bytes. */
export function isTransactionSignature(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 64 || value.length > 100) return false;
  try {
    return bs58.decode(value).length === 64;
  } catch {
    return false;
  }
}
