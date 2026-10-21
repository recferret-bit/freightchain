import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { SignedToken } from '../../domain/auth/auth-challenge.entity.js';
import type { SurfaceTokenClaims } from '../../domain/auth/surface-token.js';
import { isWalletAddress } from '../../domain/players/wallet-address.js';
import { AdminTokenPort } from '../../application/ports/admin/admin-token.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { EntropyPort } from '../../application/ports/shared/entropy.port.js';
import { EnvService } from '../config/env.service.js';

const ISSUER = 'freight-chain';
const AUDIENCE = 'fc:admin';
const MAX_TTL_S = 60 * 60;

/** Admin session tokens: HS256 JWTs with the ADMIN key (EnvService.adminJwtSecret) and audience, ADMIN_SESSION_TTL_MINUTES long, times from ClockPort. */
@Injectable()
export class JoseAdminTokenSigner extends AdminTokenPort {
  private readonly secret: Uint8Array;
  private readonly ttlS: number;

  constructor(
    env: EnvService,
    private readonly entropy: EntropyPort,
    private readonly clock: ClockPort,
  ) {
    super();
    this.secret = new TextEncoder().encode(env.adminJwtSecret);
    this.ttlS = Math.min(env.adminSessionTtlMinutes * 60, MAX_TTL_S);
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
    return (await this.verifyClaims(token))?.wallet ?? null;
  }

  async verifyClaims(token: string): Promise<SurfaceTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER, audience: AUDIENCE, currentDate: this.clock.now() });
      if (!isWalletAddress(payload.sub) || typeof payload.jti !== 'string' || !payload.jti || typeof payload.exp !== 'number') return null;
      return { wallet: payload.sub, jti: payload.jti, exp: payload.exp };
    } catch {
      return null;
    }
  }
}
