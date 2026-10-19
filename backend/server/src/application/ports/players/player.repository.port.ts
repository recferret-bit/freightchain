import type { Player } from '../../../domain/players/player.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class PlayerRepositoryPort {
  abstract findByWallet(wallet: string, tx?: TransactionHandle): Promise<Player | null>;
  /** `SELECT … FOR UPDATE`: holds the player's row until the transaction ends – serialises everything a wallet does to its rides and credits. */
  abstract findByWalletForUpdate(wallet: string, tx: TransactionHandle): Promise<Player | null>;
  /** Creates the player unless it exists (a concurrent first sight is not an error). True only when this call inserted the row. */
  abstract insertIfAbsent(player: Player, tx?: TransactionHandle): Promise<boolean>;
  /**
   * The midnight job: ONE statement gives every player whose `freeDay` is before `today` (UTC YYYY-MM-DD) +1 free ride – only below `cap`,
   * the live `free_rides_daily_max` – writes that cap onto the row, stamps `freeDay = today` and bumps the version.
   * A balance already above `cap` is left alone. Idempotent. Returns how many players it touched.
   */
  abstract grantDailyFreeRides(today: string, cap: number): Promise<number>;
  /** Optimistic lock: throws VersionConflictError when the stored version is no longer the entity's. Returns the saved entity (version + 1). */
  abstract save(player: Player, tx?: TransactionHandle): Promise<Player>;
}
