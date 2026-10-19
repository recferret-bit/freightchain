import { VersionConflictError } from '../../domain/shared/errors.js';

/** Re-run `fn` (which must re-read what it changes) when an optimistic lock was lost – for steps that must not fail just because a heartbeat raced them. */
export async function withVersionRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof VersionConflictError) || attempt >= attempts) throw error;
    }
  }
}
