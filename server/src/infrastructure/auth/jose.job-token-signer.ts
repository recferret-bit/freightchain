import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { JobTokenPort, type JobClaims } from '../../application/ports/editor/job-token.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { EntropyPort } from '../../application/ports/shared/entropy.port.js';
import { isWalletAddress } from '../../domain/players/wallet-address.js';
import { EnvService } from '../config/env.service.js';

const ISSUER = 'freight-chain';
const AUDIENCE = 'mcp-job';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A job's capability token for the MCP callbacks: HS256 with a key derived from JWT_SECRET (never a session key), audience mcp-job, valid for the job's
    timeout + 1 min. Holding it lets the MCP act as that job only (McpJobGuard also wants the job still running). */
@Injectable()
export class JoseJobTokenSigner extends JobTokenPort {
  private readonly secret: Uint8Array;
  private readonly ttlS: number;

  constructor(env: EnvService, private readonly entropy: EntropyPort, private readonly clock: ClockPort) {
    super();
    this.secret = new TextEncoder().encode(createHash('sha256').update(`${env.jwtSecret}:mcp-job`).digest('hex'));
    this.ttlS = Math.ceil(env.editorJobTimeoutMs / 1000) + 60;
  }

  async sign(c: JobClaims): Promise<string> {
    const now = Math.floor(this.clock.now().getTime() / 1000);
    return new SignJWT({ wallet: c.wallet, entityId: c.entityId }).setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.jobId).setIssuedAt(now).setExpirationTime(now + this.ttlS).setJti(this.entropy.uuid()).setIssuer(ISSUER).setAudience(AUDIENCE).sign(this.secret);
  }

  async verify(token: string): Promise<JobClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'], currentDate: this.clock.now() });
      const wallet = payload['wallet'], entityId = payload['entityId'];
      if (!UUID.test(payload.sub ?? '') || !isWalletAddress(wallet) || !(entityId === null || typeof entityId === 'string')) return null;
      return { jobId: payload.sub!, wallet, entityId };
    } catch {
      return null;
    }
  }
}
