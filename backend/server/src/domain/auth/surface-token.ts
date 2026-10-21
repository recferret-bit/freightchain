/** A privileged session after the signature check: the wallet, the revocation id, and the expiry (unix seconds). */
export interface SurfaceTokenClaims {
  wallet: string;
  jti: string;
  exp: number;
}
