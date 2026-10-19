import bs58 from 'bs58';
import { BadRequestError } from '../shared/errors.js';

export const WALLET_ADDRESS_MESSAGE = 'wallet must be a base58 Solana address';

/** A Solana address is the base58 form of 32 bytes (an ed25519 public key). */
export function isWalletAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

export function parseWalletAddress(value: unknown): string {
  if (!isWalletAddress(value)) throw new BadRequestError(WALLET_ADDRESS_MESSAGE);
  return value;
}
