import bs58 from 'bs58';
import { extractWebhookSignatures, isTransactionSignature, MAX_WEBHOOK_SIGNATURES } from '../../../src/domain/economy/webhook-signatures.js';

const sig = (n: number) => bs58.encode(new Uint8Array(64).fill(n + 1));
const [A, B, C] = [sig(1), sig(2), sig(3)];

describe('extractWebhookSignatures', () => {
  it('a bare array of signatures, and { signatures: [...] }', () => {
    expect(extractWebhookSignatures([A, B])).toEqual([A, B]);
    expect(extractWebhookSignatures({ signatures: [A, B, A] })).toEqual([A, B]);
  });

  it('Helius enhanced ({ signature, … } objects, event data ignored) and raw ({ transaction: { signatures: [first, co-signer] } })', () => {
    expect(extractWebhookSignatures([{ signature: A, type: 'UNKNOWN', nativeTransfers: [{ amount: 1e9 }] }, { signature: B }])).toEqual([A, B]);
    expect(extractWebhookSignatures([{ transaction: { signatures: [A, C], message: { accountKeys: ['11111111111111111111111111111111'] } }, meta: { logMessages: ['Program data: xyz'] } }])).toEqual([A]);
  });

  it('QuickNode Streams shapes: nested under data / matchedTransactions, at any depth', () => {
    expect(extractWebhookSignatures({ data: [{ matchedTransactions: [{ signature: A }, { transaction: { signatures: [B] } }] }] })).toEqual([A, B]);
    expect(extractWebhookSignatures({ result: { value: [[C]] } })).toEqual([C]);
  });

  it('ignores anything that is not a 64-byte base58 signature (pubkeys, text, numbers), and empty bodies', () => {
    expect(extractWebhookSignatures({ signature: 'not-base58-!!', signatures: ['11111111111111111111111111111111', 42, null], x: A.slice(1) })).toEqual([]);
    expect(extractWebhookSignatures({})).toEqual([]);
    expect(extractWebhookSignatures(null)).toEqual([]);
    expect(isTransactionSignature(A)).toBe(true);
    expect(isTransactionSignature(bs58.encode(new Uint8Array(32).fill(7)))).toBe(false);
  });

  it('refuses a delivery with more than the cap (a stream without the program filter)', () => {
    const many = Array.from({ length: MAX_WEBHOOK_SIGNATURES + 1 }, (_, i) => bs58.encode(new Uint8Array(64).fill(1).map((x, j) => (j < 2 ? (i >> (8 * j)) & 0xff : x + 1))));
    expect(extractWebhookSignatures(many)).toMatch(/at most 100 signatures/);
    expect(extractWebhookSignatures(many.slice(0, MAX_WEBHOOK_SIGNATURES))).toHaveLength(MAX_WEBHOOK_SIGNATURES);
  });
});
