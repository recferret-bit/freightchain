export abstract class SignatureVerifierPort {
  /** Is `signatureBase58` the wallet's ed25519 signature over the UTF-8 `message`? Never throws. */
  abstract verify(message: string, signatureBase58: string, wallet: string): boolean;
}
