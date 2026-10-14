import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { SignedToken } from '../../domain/auth/auth-challenge.entity.js';
import { isWalletAddress } from '../../domain/players/wallet-address.js';
import { EditorTokenPort } from '../../application/ports/editor/editor-token.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { EntropyPort } from '../../application/ports/shared/entropy.port.js';
import { EnvService } from '../config/env.service.js';

const ISSUER = 'freight-chain';
const AUDIENCE = 'editor';

/** Editor session tokens: HS256 JWTs with the EDITOR key (EnvService.editorJwtSecret) and audience, EDITOR_SESSION_TTL_MINUTES long, times from ClockPort. */
@Injectable()
export class JoseEditorTokenSigner extends EditorTokenPort {
  private readonly secret: Uint8Array;
  private readonly ttlS: number;

  constructor(
    env: EnvService,
    private readonly entropy: EntropyPort,
    private readonly clock: ClockPort,
  ) {
    super();
    this.secret = new TextEncoder().encode(env.editorJwtSecret);
    this.ttlS = env.editorSessionTtlMinutes * 60;
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
