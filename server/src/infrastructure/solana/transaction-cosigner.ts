import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { BadRequestError } from '../../domain/shared/errors.js';

/* THE security boundary of the gas sponsor (docs/paid-tickets-plan.md §2.10, risk "fee-payer drain"): the server adds its fee-payer signature only to a transaction
   whose MESSAGE BYTES are exactly the ones it built and stored with the order – so nobody can make the sponsor pay for (or sign) anything else. The wire format is
   parsed by hand (compact-u16 signature count, 64-byte signatures, then the message), so no library round-trip can normalise a difference away:
     - the message must equal the expected bytes (an extra / changed instruction, another blockhash or fee payer all change them);
     - the signature count must be the header's numRequiredSignatures, the fee payer (account 0) the sponsor, and there must be at least one other signer;
     - every other required signature must be present and VALID over these exact bytes (present is not enough).
   The blockhash age and the send loop are the adapter's (they need the network). */

export interface WireTransaction {
  signatures: Uint8Array[];
  message: Uint8Array;
  numRequiredSignatures: number;
  /** the message's static account keys; [0] is the fee payer */
  accountKeys: PublicKey[];
  recentBlockhash: string;
}

function shortVec(bytes: Uint8Array, at: number): [value: number, next: number] {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const b = bytes[at + i];
    if (b === undefined) throw new RangeError('truncated compact-u16');
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return [value, at + i + 1];
  }
  throw new RangeError('compact-u16 longer than 3 bytes');
}

/** The wire transaction (legacy or v0) split into its signatures and message, with the few message fields the checks need. */
export function parseWireTransaction(bytes: Uint8Array): WireTransaction {
  const [count, sigStart] = shortVec(bytes, 0);
  const msgStart = sigStart + count * 64;
  if (msgStart > bytes.length) throw new RangeError('truncated signatures');
  const signatures = Array.from({ length: count }, (_, i) => bytes.subarray(sigStart + i * 64, sigStart + (i + 1) * 64));
  const message = bytes.subarray(msgStart);
  let at = (message[0] ?? 0) & 0x80 ? 1 : 0; // a versioned message starts with 0x80 | version
  const numRequiredSignatures = message[at];
  if (numRequiredSignatures === undefined || message.length < at + 3) throw new RangeError('truncated message header');
  at += 3;
  const [keyCount, keysStart] = shortVec(message, at);
  const blockhashAt = keysStart + keyCount * 32;
  if (blockhashAt + 32 > message.length) throw new RangeError('truncated account keys');
  const accountKeys = Array.from({ length: keyCount }, (_, i) => new PublicKey(message.subarray(keysStart + i * 32, keysStart + (i + 1) * 32)));
  return { signatures, message, numRequiredSignatures, accountKeys, recentBlockhash: bs58.encode(message.subarray(blockhashAt, blockhashAt + 32)) };
}

const isZero = (b: Uint8Array) => b.every((x) => x === 0);
const refuse = (code: string, detail: string) => new BadRequestError(detail, code);

/** Throws a BadRequestError (code + reason for the client) unless the user-signed transaction is exactly the one the server built for the sponsor to pay. */
export function checkUserSignedTransaction(signedTransaction: Uint8Array, expectedMessage: Uint8Array, sponsor: PublicKey): WireTransaction {
  let wire: WireTransaction;
  try {
    wire = parseWireTransaction(signedTransaction);
  } catch (e) {
    throw refuse('transaction_malformed', `not a Solana transaction: ${(e as Error).message}`);
  }
  if (Buffer.compare(Buffer.from(wire.message), Buffer.from(expectedMessage)) !== 0) throw refuse('transaction_mismatch', 'the transaction differs from the one the server built – rebuild it');
  if (wire.signatures.length !== wire.numRequiredSignatures) throw refuse('transaction_malformed', `${wire.signatures.length} signatures for ${wire.numRequiredSignatures} required signers`);
  if (!wire.accountKeys[0]?.equals(sponsor)) throw refuse('fee_payer_mismatch', 'the transaction is not paid by the gas sponsor');
  if (wire.numRequiredSignatures < 2) throw refuse('signature_missing', 'the transaction carries no wallet signature');
  for (let i = 1; i < wire.numRequiredSignatures; i++) {
    const key = wire.accountKeys[i]!, sig = wire.signatures[i]!;
    if (isZero(sig)) throw refuse('signature_missing', `${key.toBase58()} has not signed the transaction`);
    if (!nacl.sign.detached.verify(wire.message, sig, key.toBytes())) throw refuse('signature_invalid', `the signature of ${key.toBase58()} is not valid`);
  }
  return wire;
}

/** The wire bytes with the sponsor's signature in slot 0 (the fee payer's). */
export function addFeePayerSignature(wire: WireTransaction, sponsorSecretKey: Uint8Array): Uint8Array {
  const own = nacl.sign.detached(wire.message, sponsorSecretKey);
  const count = wire.signatures.length; // < 128 for any real transaction: one compact-u16 byte
  return Buffer.concat([Buffer.from([count]), Buffer.from(own), ...wire.signatures.slice(1).map((s) => Buffer.from(s)), Buffer.from(wire.message)]);
}
