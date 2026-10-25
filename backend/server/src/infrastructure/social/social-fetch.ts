import { ServiceUnavailableError } from '../../domain/shared/errors.js';

export interface FetchLike {
  (url: string, init?: RequestInit): Promise<{ ok: boolean; json(): Promise<unknown> }>;
}

/** Never expose provider URLs: Telegram puts its credential in the path. */
export async function socialJson(url: string, init: RequestInit, code: string, fetchImpl: FetchLike = fetch): Promise<unknown> {
  try {
    const res = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('provider refused');
    return await res.json();
  } catch {
    throw new ServiceUnavailableError('social verification provider unavailable', code);
  }
}
