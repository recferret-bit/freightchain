import type { Player } from '../../../domain/players/player.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class PlayerRepositoryPort {
  abstract findByWallet(wallet: string, tx?: TransactionHandle): Promise<Player | null>;
  /** `SELECT … FOR UPDATE`: holds the player's row until the transaction ends – serialises everything a wallet does to its rides and credits. */
  abstract findByWalletForUpdate(wallet: string, tx: TransactionHandle): Promise<Player | null>;
  /** Creates the player unless it exists (a concurrent first sight is not an error). */
  abstract insertIfAbsent(player: Player, tx?: TransactionHandle): Promise<void>;
  /** Optimistic lock: throws VersionConflictError when the stored version is no longer the entity's. Returns the saved entity (version + 1). */
  abstract save(player: Player, tx?: TransactionHandle): Promise<Player>;
}
