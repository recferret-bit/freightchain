import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { SignedToken } from '../../domain/auth/auth-challenge.entity.js';
import { isWalletAddress } from '../../domain/players/wallet-address.js';
import { TokenSignerPort } from '../../application/ports/auth/token-signer.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { EntropyPort } from '../../application/ports/shared/entropy.port.js';
import { EnvService } from '../config/env.service.js';

const ISSUER = 'freight-chain';
const AUDIENCE = 'fc:player';
const DAY_S = 86_400;

/** Session tokens: HS256 JWTs whose subject is the wallet. Issue and expiry times come from ClockPort (like every timestamp the server makes). */
@Injectable()
export class JoseTokenSigner extends TokenSignerPort {
  private readonly secret: Uint8Array;
  private readonly ttlS: number;

  constructor(
    env: EnvService,
    private readonly entropy: EntropyPort,
    private readonly clock: ClockPort,
  ) {
    super();
    this.secret = new TextEncoder().encode(env.jwtSecret);
    this.ttlS = env.sessionTtlDays * DAY_S;
  }

  async sign(wallet: string): Promise<SignedToken> {
    const issuedS = Math.floor(this.clock.now().getTime() / 1000);
    const expiresS = issuedS + this.ttlS;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(wallet).setIssuedAt(issuedS).setExpirationTime(expiresS).setJti(this.entropy.uuid()).setIssuer(ISSUER).setAudience(AUDIENCE)
      .sign(this.secret);
    return { token, expiresAt: new Date(expiresS * 1000) };
  }

  async verify(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER, audience: AUDIENCE, currentDate: this.clock.now() });
      return isWalletAddress(payload.sub) ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
