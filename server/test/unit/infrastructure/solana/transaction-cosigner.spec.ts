import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { BadRequestError } from '../../../../src/domain/shared/errors.js';
import { addFeePayerSignature, checkUserSignedTransaction, parseWireTransaction } from '../../../../src/infrastructure/solana/transaction-cosigner.js';
import { PoolProgramCodec } from '../../../../src/infrastructure/solana/pool-program.codec.js';
import { poolProgramFixture } from '../../../support/chain-fixtures.js';

/* The fee-payer drain is the one attack the gas sponsor opens: these are the ways someone could try to get the server's signature on something it did not build. */
const codec = new PoolProgramCodec(poolProgramFixture().programId);
const sponsor = Keypair.generate(), buyer = Keypair.generate(), thief = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();

const buyIx = (who = buyer.publicKey, qty = 1): TransactionInstruction => codec.instruction('buy_ticket', {
  buyer: who, fee_payer: sponsor.publicKey, config: codec.configPda(), pool: codec.poolPda(0), vault: codec.vaultPda(0), ticket: codec.ticketPda(0, who),
}, { pool_id: 0, qty, order_id: new Uint8Array(16).fill(7) });
const built = (ixs: TransactionInstruction[] = [buyIx()], feePayer = sponsor.publicKey, hash = blockhash) =>
  new Transaction({ feePayer, blockhash: hash, lastValidBlockHeight: 100 }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 30_000 }), ...ixs);
/** what the server stores with the order */
const expected = built().serializeMessage();
/** what the wallet does with signTransaction: partialSign with its own key, return the wire bytes */
const signedBy = (tx: Transaction, ...signers: Keypair[]) => { if (signers.length) tx.partialSign(...signers); return tx.serialize({ requireAllSignatures: false, verifySignatures: false }); };
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { return e as BadRequestError; } throw new Error('not refused'); };

describe('checkUserSignedTransaction – what the sponsor co-signs', () => {
  it('accepts exactly the built transaction, signed by the buyer; the co-signed bytes are a fully valid transaction', () => {
    const wire = checkUserSignedTransaction(signedBy(built(), buyer), expected, sponsor.publicKey);
    expect(Buffer.from(wire.message).equals(expected)).toBe(true);
    const raw = addFeePayerSignature(wire, sponsor.secretKey);
    const tx = Transaction.from(raw);
    expect(tx.verifySignatures()).toBe(true);
    expect(tx.feePayer?.equals(sponsor.publicKey)).toBe(true);
    expect(Buffer.from(tx.serializeMessage()).equals(expected)).toBe(true);
  });

  const cases: [string, () => Buffer | Uint8Array, string][] = [
    ['a forged message (another buyer pays nothing, the thief gets the ticket)', () => signedBy(built([buyIx(thief.publicKey)]), thief), 'transaction_mismatch'],
    ['a changed argument (qty 1 → 2)', () => signedBy(built([buyIx(buyer.publicKey, 2)]), buyer), 'transaction_mismatch'],
    ['an extra instruction (drain the sponsor to the thief)', () => signedBy(built([buyIx(), SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: thief.publicKey, lamports: 1e9 })]), buyer), 'transaction_mismatch'],
    ['another fee payer', () => signedBy(built([buyIx()], buyer.publicKey), buyer), 'transaction_mismatch'],
    ['another blockhash', () => signedBy(built([buyIx()], sponsor.publicKey, Keypair.generate().publicKey.toBase58()), buyer), 'transaction_mismatch'],
    ['no wallet signature', () => signedBy(built()), 'signature_missing'],
    ['a wallet signature by the wrong key', () => {
      const raw = Buffer.from(signedBy(built()));
      raw.set(nacl.sign.detached(expected, thief.secretKey), 1 + 64);
      return raw;
    }, 'signature_invalid'],
    ['a bit-flipped wallet signature', () => { const raw = Buffer.from(signedBy(built(), buyer)); raw[1 + 64 + 5]! ^= 1; return raw; }, 'signature_invalid'],
    ['garbage', () => Buffer.from([5, 1, 2, 3]), 'transaction_malformed'],
    ['an empty body', () => Buffer.alloc(0), 'transaction_malformed'],
  ];
  for (const [name, make, code] of cases) {
    it(`refuses ${name} → 400 ${code}`, () => {
      const e = refusal(() => checkUserSignedTransaction(make(), expected, sponsor.publicKey));
      expect(e).toBeInstanceOf(BadRequestError);
      expect(e.errorCode).toBe(code);
    });
  }

  it('refuses a message whose fee payer is not THIS sponsor, even when it is the stored one (never sign as somebody else\'s fee payer)', () => {
    const other = Keypair.generate();
    const tx = new Transaction({ feePayer: other.publicKey, blockhash, lastValidBlockHeight: 1 }).add(buyIx());
    const e = refusal(() => checkUserSignedTransaction(signedBy(tx, buyer), tx.serializeMessage(), sponsor.publicKey));
    expect(e.errorCode).toBe('fee_payer_mismatch');
  });

  it('refuses a message only the sponsor would sign (no wallet in it)', () => {
    const tx = new Transaction({ feePayer: sponsor.publicKey, blockhash, lastValidBlockHeight: 1 }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }));
    expect(refusal(() => checkUserSignedTransaction(signedBy(tx), tx.serializeMessage(), sponsor.publicKey)).errorCode).toBe('signature_missing');
  });

  it('refuses a signature count that disagrees with the header', () => {
    const raw = Buffer.from(signedBy(built(), buyer));
    const short = Buffer.concat([Buffer.from([1]), raw.subarray(1 + 64, 1 + 128), raw.subarray(1 + 128)]);
    expect(refusal(() => checkUserSignedTransaction(short, expected, sponsor.publicKey)).errorCode).toBe('transaction_malformed');
  });
});

describe('parseWireTransaction', () => {
  it('splits legacy and v0 transactions into signatures + message bytes', () => {
    const legacy = parseWireTransaction(signedBy(built(), buyer));
    expect(legacy).toMatchObject({ numRequiredSignatures: 2, recentBlockhash: blockhash });
    expect(legacy.accountKeys[0]!.equals(sponsor.publicKey)).toBe(true);
    const msg = new TransactionMessage({ payerKey: sponsor.publicKey, recentBlockhash: blockhash, instructions: [buyIx()] }).compileToV0Message();
    const v0 = new VersionedTransaction(msg);
    v0.sign([buyer]);
    const parsed = parseWireTransaction(v0.serialize());
    expect(parsed.numRequiredSignatures).toBe(2);
    expect(Buffer.from(parsed.message).equals(Buffer.from(msg.serialize()))).toBe(true);
    expect(parsed.accountKeys.map((k) => k.toBase58())).toContain(buyer.publicKey.toBase58());
    expect(checkUserSignedTransaction(v0.serialize(), msg.serialize(), sponsor.publicKey).signatures.length).toBe(2);
    expect(new PublicKey(parsed.accountKeys[1]!).equals(buyer.publicKey)).toBe(true);
  });
});
