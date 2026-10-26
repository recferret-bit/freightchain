import type { TransactionHandle } from '../ports/shared/transaction.port.js';
import type { AirdropRow } from './airdrop-rules.js';

export type SocialClaim = 'ok' | 'taken' | 'changed';

/** One campaign row per wallet. Social ids are unique across wallets. */
export abstract class AirdropRepositoryPort {
  abstract reserveXBudget(costCents: number, maxCents: number, tx: TransactionHandle): Promise<boolean>;
  abstract findTelegramOwner(telegramUserId: string): Promise<string | null>;
  abstract get(wallet: string, tx?: TransactionHandle): Promise<AirdropRow | null>;
  abstract save(row: AirdropRow, tx?: TransactionHandle): Promise<void>;
  /** Binds `telegramUserId` to `wallet`. `taken` = another wallet holds it. `changed` = this wallet already has a different id. */
  abstract claimTelegram(wallet: string, telegramUserId: string, tx?: TransactionHandle): Promise<SocialClaim>;
  abstract claimX(wallet: string, xUserId: string, tx?: TransactionHandle): Promise<SocialClaim>;
}
