import { Keypair, SystemProgram, Transaction, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { SolanaChainAdapter } from '../../../../src/infrastructure/solana/solana-chain.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { ServiceUnavailableError } from '../../../../src/domain/shared/errors.js';

/** The RPC itself is replaced: this checks what the adapter asks for and how it shapes the answers (the real RPC shape: scripts/check-rpc-shape.mjs). */
function adapterWith(rpc: Record<string, unknown>) {
  const adapter = new SolanaChainAdapter({ solanaRpc: 'http://127.0.0.1:1' } as unknown as EnvService);
  Object.assign((adapter as unknown as { connection: object }).connection, rpc);
  return adapter;
}
const payer = Keypair.generate().publicKey.toBase58(), treasury = Keypair.generate().publicKey.toBase58();

describe('SolanaChainAdapter', () => {
  it('builds the unsigned transfer + memo against the latest blockhash', async () => {
    const blockhash = Keypair.generate().publicKey.toBase58();
    const adapter = adapterWith({ getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 99 }) });
    const out = await adapter.buildPaymentTransaction({ payer, treasury, lamports: 42, memo: 'ride-1' });
    expect(out).toMatchObject({ blockhash, lastValidBlockHeight: 99 });
    const tx = Transaction.from(Buffer.from(out.transaction, 'base64'));
    expect(tx.feePayer?.toBase58()).toBe(payer);
    expect(tx.instructions[0]?.programId.equals(SystemProgram.programId)).toBe(true);
    expect(tx.instructions[1]?.data.toString()).toBe('ride-1');
  });

  it('getTransaction: null when not visible yet; the chain view when it is', async () => {
    expect(await adapterWith({ getParsedTransaction: async () => null }).getTransaction('sig')).toBeNull();
    const parsed = { meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: Keypair.generate().publicKey, signer: true }], instructions: [] } } } as unknown as ParsedTransactionWithMeta;
    expect(await adapterWith({ getParsedTransaction: async () => parsed }).getTransaction('sig')).toMatchObject({ outcome: 'success', transfers: [], memos: [] });
  });

  it('recentSignatures keeps only the successful ones, with their memo', async () => {
    const adapter = adapterWith({ getSignaturesForAddress: async () => [{ signature: 'a', memo: '[1] x', err: null }, { signature: 'b', memo: null, err: { boom: 1 } }] });
    expect(await adapter.recentSignatures(payer, 25)).toEqual([{ signature: 'a', memo: '[1] x' }]);
  });

  it('an RPC failure is "unavailable" – never "not found"', async () => {
    const down = async () => { throw new Error('429 Too Many Requests'); };
    const adapter = adapterWith({ getParsedTransaction: down, getLatestBlockhash: down, getSignaturesForAddress: down });
    await expect(adapter.getTransaction('sig')).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(adapter.buildPaymentTransaction({ payer, treasury, lamports: 1, memo: 'm' })).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(adapter.recentSignatures(payer, 1)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
