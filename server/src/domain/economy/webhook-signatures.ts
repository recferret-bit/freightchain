import bs58 from 'bs58';

/** More than this in one delivery is a stream without the program filter (a whole block) – refused instead of costing an RPC read each. */
export const MAX_WEBHOOK_SIGNATURES = 100;
const MAX_DEPTH = 8;

/** A base58 Solana transaction signature (64 bytes). */
export const isTransactionSignature = (s: unknown): s is string => {
  if (typeof s !== 'string' || s.length < 64 || s.length > 90) return false;
  try {
    return bs58.decode(s).length === 64;
  } catch {
    return false;
  }
};

/**
 * The transaction signatures in a webhook delivery (QuickNode Streams, Helius raw / enhanced, or a hand-made replay) – and NOTHING else: event data in the body
 * is never trusted, every signature is read back from the chain (SettleChainSignatureCommand). Accepted shapes, at any nesting (`data`, `matchedTransactions`,
 * `result`, … are walked through): a bare signature string inside an array, `{ signature }`, `{ signatures: [...] }` (every one), `{ transaction: { signatures:
 * [first, …] } }` (the FIRST only – the others are co-signers' signatures, not the transaction's id). Strings that are not signatures are ignored; duplicates
 * collapse, first-seen order kept. Returns an error message when a delivery carries more than MAX_WEBHOOK_SIGNATURES.
 */
export function extractWebhookSignatures(body: unknown): string[] | string {
  const found = new Set<string>();
  const add = (s: unknown) => { if (isTransactionSignature(s)) found.add(s); };
  const walk = (v: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) typeof item === 'string' ? add(item) : walk(item, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    add(o['signature']);
    const txSignatures = (o['transaction'] as { signatures?: unknown } | null | undefined)?.signatures;
    if (Array.isArray(txSignatures)) add(txSignatures[0]);
    for (const [key, child] of Object.entries(o)) {
      if (key === 'signature' || (key === 'transaction' && Array.isArray(txSignatures))) continue; // taken above
      walk(child, depth + 1);
    }
  };
  walk(body, 0);
  if (found.size > MAX_WEBHOOK_SIGNATURES) return `at most ${MAX_WEBHOOK_SIGNATURES} signatures per delivery (filter the stream to the pool program)`;
  return [...found];
}
