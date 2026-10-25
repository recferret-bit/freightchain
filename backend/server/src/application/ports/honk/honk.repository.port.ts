import type { HonkPartSeed } from '../../../domain/honk/parts-catalog.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export interface HonkMintInput {
  rideId: string;
  wallet: string;
  tier: string;
  distance: number;
  completeDist: number;
}

export interface HonkMintRow {
  rideId: string;
  wallet: string;
  tier: string;
  amount: bigint;
  band20: boolean;
  band50: boolean;
  band100: boolean;
  createdAt: Date;
  /** When an 8h mint may credit the wallet. Immediate tiers use the insert time. */
  releaseAt: Date;
  /** False while an 8h mint is reserved and not yet credited. Existing rows default true. */
  released: boolean;
  /** Only rewards created with chain emission enabled enter the durable retry queue. */
  chainPending?: boolean;
  chainRetryAt?: Date | null;
  chainSentAt?: Date | null;
}

export interface HonkAccountRow {
  wallet: string;
  balance: bigint;
  minted: bigint;
  burned: bigint;
}

export interface HonkVisualRow {
  id: string;
  wallet: string;
  slot: string;
  item: string;
  amount: bigint;
  createdAt: Date;
  /** Frozen supply-1 mint from the player's buy_part, when HONK_PROGRAM_ID is set. Null on the ledger-only path. */
  chainMint?: string | null;
  chainSignature?: string | null;
}

export interface HonkBurnRow {
  id: string;
  wallet: string;
  amount: bigint;
  kind: 'stream' | 'visual' | 'time' | 'weather';
  ref: string;
  createdAt: Date;
}

export abstract class HonkRepositoryPort {
  abstract findMint(rideId: string, tx?: TransactionHandle): Promise<HonkMintRow | null>;
  /** The emission already minted, holding the supply row so two rides cannot both pass the cap. */
  abstract lockEmission(tx?: TransactionHandle): Promise<bigint>;
  abstract addEmission(amount: bigint, tx?: TransactionHandle): Promise<void>;
  abstract subEmission(amount: bigint, tx?: TransactionHandle): Promise<void>;
  /** Mint rows stamped on the unix day starting at `start`, one wallet or every wallet. Pending rows count. */
  abstract emittedOnDay(start: Date, wallet: string | null, tx?: TransactionHandle): Promise<bigint>;
  /** False when that rideId was already inserted. */
  abstract insertMint(row: HonkMintRow, tx?: TransactionHandle): Promise<boolean>;
  /** True only when this call flipped an unreleased row. */
  abstract markReleased(rideId: string, tx?: TransactionHandle): Promise<boolean>;
  /** True only when an unreleased row was deleted. */
  abstract deleteMint(rideId: string, tx?: TransactionHandle): Promise<boolean>;
  abstract listDue(now: Date, limit: number): Promise<HonkMintRow[]>;
  abstract listChainPending(now: Date, limit: number): Promise<HonkMintRow[]>;
  abstract deferChain(rideId: string, until: Date, tx?: TransactionHandle): Promise<void>;
  abstract markChainSent(rideId: string, at: Date, tx?: TransactionHandle): Promise<void>;
  abstract balance(wallet: string, tx?: TransactionHandle): Promise<bigint>;
  abstract account(wallet: string, tx?: TransactionHandle): Promise<HonkAccountRow>;
  /** False when the balance cannot cover it. Does not change the emission counter. */
  abstract debit(wallet: string, amount: bigint, at: Date, tx?: TransactionHandle): Promise<boolean>;
  abstract credit(wallet: string, amount: bigint, at: Date, tx?: TransactionHandle): Promise<void>;
  abstract insertBurn(row: HonkBurnRow, tx?: TransactionHandle): Promise<void>;
  /** Puts a stream burn back when the chat line was refused. */
  abstract reverseBurn(id: string, tx?: TransactionHandle): Promise<void>;
  abstract lastStreamBurn(wallet: string, rideId: string, tx?: TransactionHandle): Promise<Date | null>;
  abstract counts(wallet: string): Promise<{ mints: number; finishes: number }>;
  abstract visuals(wallet: string, tx?: TransactionHandle): Promise<HonkVisualRow[]>;
  /** False when this wallet already has this slot+item. */
  abstract insertVisual(row: HonkVisualRow, tx?: TransactionHandle): Promise<boolean>;
  /** Cab catalog in sort order. Reference data: no transaction. */
  abstract listParts(): Promise<HonkPartSeed[]>;
  abstract findPart(slot: string, item: string, tx?: TransactionHandle): Promise<HonkPartSeed | null>;
  /** The chain mint of a visual that already landed. */
  abstract setVisualChain(id: string, mint: string, signature: string | null, tx?: TransactionHandle): Promise<void>;
  abstract deleteVisual(id: string, tx?: TransactionHandle): Promise<void>;
}
