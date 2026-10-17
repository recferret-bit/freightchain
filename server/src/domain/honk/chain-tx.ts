/** A confirmed TEN4 (`freightchain_honk`) program transaction, reduced to the burns and part mints a confirm will accept. The adapter fills this; handlers do not parse bytes. */

export interface HonkChainBurn {
  amount: bigint;
  authority: string;
}

export interface HonkChainPart {
  slot: string;
  item: string;
  buyer: string;
  mint: string;
  /** TEN4 this buy burned, base units. */
  burned: bigint;
  frozen: boolean;
  /** Whole supply of the new mint. */
  supply: bigint;
  decimals: number;
  /** Owner of the minted token account. Null when the transaction does not say. */
  holder: string | null;
}

export interface HonkChainTx {
  signers: readonly string[];
  burns: readonly HonkChainBurn[];
  parts: readonly HonkChainPart[];
}

/** The wallet signed, and its program burns of TEN4 add up to exactly `amount`. */
export function confirmsHonkBurn(tx: HonkChainTx, wallet: string, amount: bigint): boolean {
  if (!tx.signers.includes(wallet)) return false;
  const burned = tx.burns.filter((b) => b.authority === wallet).reduce((sum, b) => sum + b.amount, 0n);
  return burned === amount;
}

/** The wallet signed a buy of this slot and item that burned `amount` and minted a frozen supply-1 token to them. The mint address, or null. */
export function confirmsHonkPart(tx: HonkChainTx, wallet: string, slot: string, item: string, amount: bigint): string | null {
  if (!tx.signers.includes(wallet)) return null;
  const part = tx.parts.find((p) => p.buyer === wallet && p.slot === slot && p.item === item && p.burned === amount && p.frozen && p.supply === 1n && p.decimals === 0 && p.holder === wallet);
  return part?.mint ?? null;
}
