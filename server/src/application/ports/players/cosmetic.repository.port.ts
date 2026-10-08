import type { CosmeticSlot } from '../../../domain/economy/cosmetics.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export interface CosmeticUnlockRecord {
  wallet: string;
  slot: CosmeticSlot;
  item: string;
  /** the promo code that gave it */
  code: string;
  at: Date;
}

/** What a wallet owns and wears (visuals only). Defaults are implicit: they are never stored, everybody owns them. Writes run under the wallet's player row lock. */
export abstract class CosmeticRepositoryPort {
  /** false when the wallet already owns the item (the primary key (wallet, slot, item) – nothing changes). */
  abstract unlock(record: CosmeticUnlockRecord, tx?: TransactionHandle): Promise<boolean>;
  abstract has(wallet: string, slot: CosmeticSlot, item: string, tx?: TransactionHandle): Promise<boolean>;
  abstract listUnlocked(wallet: string, tx?: TransactionHandle): Promise<CosmeticUnlockRecord[]>;
  /** Wears `item` in `slot` (replaces what was worn there). */
  abstract equip(wallet: string, slot: CosmeticSlot, item: string, tx?: TransactionHandle): Promise<void>;
  /** The worn items; a slot nothing was equipped in is missing. */
  abstract listEquipped(wallet: string, tx?: TransactionHandle): Promise<Partial<Record<CosmeticSlot, string>>>;
}
