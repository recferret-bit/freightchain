import type { HonkChainTx } from '../../../domain/honk/chain-tx.js';

/** Reads a confirmed TEN4 (`freightchain_honk`) program transaction. `programId()` is null when `HONK_PROGRAM_ID` is unset: the ledger stands alone and no signature is read. */
export abstract class HonkChainPort {
  abstract programId(): string | null;
  /** null when the signature is not on the confirmed ledger. An RPC failure throws ServiceUnavailableError, never "not found". */
  abstract load(signature: string): Promise<HonkChainTx | null>;
}
