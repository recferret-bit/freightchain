import { confirmsHonkBurn, confirmsHonkPart } from '../../../domain/honk/chain-tx.js';
import { TOKEN_SYMBOL } from '../../../domain/honk/tokenomics.js';
import { BadRequestError } from '../../../domain/shared/errors.js';
import { HonkChainPort } from '../../ports/honk/honk-chain.port.js';

/** No-op when the program id is unset. Otherwise the signature must be a confirmed burn of exactly `amount` by this wallet. A miss throws before any debit. */
export async function requireHonkBurn(chain: HonkChainPort, signature: string | undefined, wallet: string, amount: bigint): Promise<void> {
  if (!chain.programId()) return;
  if (!signature) throw new BadRequestError(`a confirmed ${TOKEN_SYMBOL} burn is required`, 'bad_signature');
  const tx = await chain.load(signature);
  if (!tx || !confirmsHonkBurn(tx, wallet, amount)) throw new BadRequestError(`that transaction does not burn this ${TOKEN_SYMBOL}`, 'bad_signature');
}

/** Null when the program id is unset. Otherwise the signature must buy this exact part. A miss throws before any debit. */
export async function requireHonkPart(chain: HonkChainPort, signature: string | undefined, wallet: string, slot: string, item: string, amount: bigint): Promise<{ mint: string; signature: string } | null> {
  if (!chain.programId()) return null;
  if (!signature) throw new BadRequestError('a confirmed part purchase is required', 'bad_signature');
  const tx = await chain.load(signature);
  const mint = tx ? confirmsHonkPart(tx, wallet, slot, item, amount) : null;
  if (!mint) throw new BadRequestError('that transaction does not buy this part', 'bad_signature');
  return { mint, signature };
}
