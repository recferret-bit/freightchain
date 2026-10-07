import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { NaclSignatureVerifier } from '../../../../src/infrastructure/auth/nacl.signature-verifier.js';

const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
const signed = (message: string, key = kp) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), key.secretKey));

describe('NaclSignatureVerifier', () => {
  const verifier = new NaclSignatureVerifier();
  it('accepts the wallet signature over the exact message', () => expect(verifier.verify('hello', signed('hello'), wallet)).toBe(true));
  it('rejects another message, another key, junk, wrong sizes – and never throws', () => {
    expect(verifier.verify('hello', signed('hellO'), wallet)).toBe(false);
    expect(verifier.verify('hello', signed('hello', nacl.sign.keyPair()), wallet)).toBe(false);
    for (const bad of ['', 'not-base58-0OIl', '1'.repeat(10), signed('hello').slice(1)]) expect(verifier.verify('hello', bad, wallet)).toBe(false);
    expect(verifier.verify('hello', signed('hello'), 'not-a-wallet')).toBe(false);
  });
});
