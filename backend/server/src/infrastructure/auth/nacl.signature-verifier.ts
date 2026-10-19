import { Injectable } from '@nestjs/common';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { SignatureVerifierPort } from '../../application/ports/auth/signature-verifier.port.js';

const SIGNATURE_BYTES = 64;

@Injectable()
export class NaclSignatureVerifier extends SignatureVerifierPort {
  verify(message: string, signatureBase58: string, wallet: string): boolean {
    try {
      const signature = bs58.decode(signatureBase58);
      if (signature.length !== SIGNATURE_BYTES) return false;
      return nacl.sign.detached.verify(new TextEncoder().encode(message), signature, bs58.decode(wallet));
    } catch {
      return false; // not base58, wrong sizes…
    }
  }
}
