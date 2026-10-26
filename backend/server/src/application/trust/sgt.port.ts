import type { TransactionHandle } from '../ports/shared/transaction.port.js';

export interface SgtProof { mint: string; slot: number }
export interface SgtClaim extends SgtProof { wallet: string; at: Date }
export abstract class SgtOwnershipPort {
  abstract enabled(): boolean;
  abstract verify(wallet: string): Promise<SgtProof[]>;
}
export abstract class SgtRepositoryPort {
  abstract byWallet(wallet: string, tx?: TransactionHandle): Promise<SgtClaim | null>;
  /** Both mint and wallet are unique; a transferred mint never awards a second wallet. */
  abstract claim(row: SgtClaim, tx: TransactionHandle): Promise<boolean>;
}
