import { Injectable } from '@nestjs/common';
import { TurnstilePort } from '../../application/airdrop/turnstile.port.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import { EnvService } from '../config/env.service.js';
import { socialJson, type FetchLike } from './social-fetch.js';

export function turnstileSuccess(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as { success?: unknown }).success === true;
}

export async function verifyTurnstile(secret: string | null, token: string, fetchImpl: FetchLike | null, hostname?: string): Promise<boolean> {
  if (!secret || !fetchImpl) throw new ServiceUnavailableError('Turnstile secret is not set', 'turnstile_unconfigured');
  const body = new URLSearchParams({ secret, response: token }).toString();
  const result = await socialJson('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }, 'turnstile_unavailable', fetchImpl);
  if (!turnstileSuccess(result)) return false;
  const claims = result as { hostname?: unknown; action?: unknown };
  return !hostname || (claims.hostname === hostname && claims.action === 'preseason');
}

@Injectable()
export class TurnstileAdapter extends TurnstilePort {
  constructor(private readonly env: EnvService) { super(); }
  override get required(): boolean { return !!(this.env.turnstileSecretKey || this.env.telegramBotToken || this.env.twitterApiIoKey); }
  verify(token: string): Promise<boolean> {
    return verifyTurnstile(this.env.turnstileSecretKey ?? null, token, fetch, new URL(this.env.appOrigin).hostname);
  }
}
