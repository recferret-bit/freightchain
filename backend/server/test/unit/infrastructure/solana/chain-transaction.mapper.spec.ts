import { Keypair, PublicKey, SystemProgram, type ParsedTransactionWithMeta } from '@solana/web3.js';
import bs58 from 'bs58';
import { MEMO_PROGRAM, toChainTransaction } from '../../../../src/infrastructure/solana/chain-transaction.mapper.js';

const payer = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();

/** a parsed transaction as getParsedTransaction returns it */
function parsed(over: { err?: unknown; noMeta?: boolean; instructions?: unknown[]; signer?: boolean; accountKeys?: unknown[] } = {}): ParsedTransactionWithMeta {
  return {
    slot: 1, blockTime: 0, meta: over.noMeta ? null : { err: over.err ?? null },
    transaction: { signatures: [], message: { recentBlockhash: '', accountKeys: over.accountKeys ?? [{ pubkey: new PublicKey(payer), signer: over.signer ?? true, writable: true, source: 'transaction' }], instructions: over.instructions ?? [] } },
  } as unknown as ParsedTransactionWithMeta;
}
const transfer = (lamports: number | string, source = payer, destination = treasury) => ({ program: 'system', programId: SystemProgram.programId, parsed: { type: 'transfer', info: { source, destination, lamports } } });
const memo = (text: string) => ({ program: 'spl-memo', programId: MEMO_PROGRAM, parsed: text });
const computeBudget = { programId: new PublicKey('ComputeBudget111111111111111111111111111111'), accounts: [], data: '3DTZbgwcZoUj' }; // partially decoded: no `parsed`

describe('toChainTransaction (the RPC shape → what payment verification reads)', () => {
  it('reads the fee payer, every transfer and every memo; ignores instructions it does not understand', () => {
    const tx = toChainTransaction(parsed({ instructions: [computeBudget, transfer(42_000_000), memo('ride-1'), { program: 'system', programId: SystemProgram.programId, parsed: { type: 'createAccount', info: {} } }] }));
    expect(tx).toEqual({ outcome: 'success', feePayer: payer, feePayerSigned: true, transfers: [{ source: payer, destination: treasury, lamports: 42_000_000 }], memos: ['ride-1'], accountKeys: [payer] });
  });
  it('lamports may arrive as a numeric string', () => {
    expect(toChainTransaction(parsed({ instructions: [transfer('7')] })).transfers[0]?.lamports).toBe(7);
  });
  it('flags a failed transaction and a missing meta', () => {
    expect(toChainTransaction(parsed({ err: { InstructionError: [0, 'Custom'] } })).outcome).toBe('failed');
    expect(toChainTransaction(parsed({ noMeta: true })).outcome).toBe('no_metadata');
  });
  it('reads a memo the RPC left unparsed because a reference account is on it', () => {
    const reference = Keypair.generate().publicKey.toBase58();
    const tx = toChainTransaction(parsed({
      accountKeys: [{ pubkey: new PublicKey(payer), signer: true, writable: true, source: 'transaction' }, { pubkey: new PublicKey(reference), signer: false, writable: false, source: 'transaction' }],
      instructions: [{ programId: MEMO_PROGRAM, accounts: [new PublicKey(reference)], data: bs58.encode(Buffer.from('ride-1')) }],
    }));
    expect(tx.memos).toEqual(['ride-1']);
    expect(tx.accountKeys).toContain(reference);
  });

  it('knows when the fee payer did not sign', () => {
    expect(toChainTransaction(parsed({ signer: false })).feePayerSigned).toBe(false);
  });
});
