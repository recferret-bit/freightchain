import { Injectable } from '@nestjs/common';
import { TurnstilePort } from '../../application/airdrop/turnstile.port.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import type { FetchLike } from './telegram-bot.adapter.js';

export function turnstileSuccess(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as { success?: unknown }).success === true;
}

/**
 * Siteverify against a caller-supplied secret. A null secret throws before any request, so booting does not need a real Turnstile secret.
 * The Nest instance always passes a null secret.
 */
export async function verifyTurnstile(secret: string | null, token: string, fetchImpl: FetchLike | null): Promise<boolean> {
  if (!secret || !fetchImpl) throw new ServiceUnavailableError('Turnstile secret is not set', 'turnstile_unconfigured');
  const body = new URLSearchParams({ secret, response: token }).toString();
  const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  return turnstileSuccess(await res.json());
}

@Injectable()
export class TurnstileAdapter extends TurnstilePort {
  verify(token: string): Promise<boolean> {
    return verifyTurnstile(null, token, null);
  }
}
