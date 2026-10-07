export interface IssueChallengeInput {
  wallet: string;
  domain: string;
  origin: string;
  nonce: string;
  now: Date;
  ttlMs: number;
}

/** A Sign-In-With-Solana challenge: the server builds the exact text, the wallet signs it, the server verifies the signature over the STORED text. */
export class AuthChallenge {
  constructor(
    readonly wallet: string,
    readonly message: string,
    readonly expiresAt: Date,
  ) {}

  static issue(input: IssueChallengeInput): AuthChallenge {
    const expiresAt = new Date(input.now.getTime() + input.ttlMs);
    const message = [
      `${input.domain} wants you to sign in with your Solana account:`,
      input.wallet,
      '',
      'Sign in to Freight Chain. This request will not trigger a transaction or cost any fees.',
      '',
      `URI: ${input.origin}`,
      `Nonce: ${input.nonce}`,
      `Issued At: ${input.now.toISOString()}`,
      `Expiration Time: ${expiresAt.toISOString()}`,
    ].join('\n');
    return new AuthChallenge(input.wallet, message, expiresAt);
  }

  isExpired(now: Date): boolean {
    return this.expiresAt.getTime() < now.getTime();
  }
}

export interface SignedToken {
  token: string;
  expiresAt: Date;
}
