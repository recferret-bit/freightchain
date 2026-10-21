import { ForbiddenError } from '../shared/errors.js';

export const CURRENT_TERMS_VERSION = 1;
export const CURRENT_PRIVACY_VERSION = 1;

/** Missing or older than the current pair is 403. A player who has both current versions passes. */
export function assertTermsCurrent(termsVersion: number | null | undefined, privacyVersion: number | null | undefined): void {
  if (termsVersion == null || privacyVersion == null || termsVersion < CURRENT_TERMS_VERSION || privacyVersion < CURRENT_PRIVACY_VERSION) {
    throw new ForbiddenError('the current terms and privacy notice have not been accepted', 'terms_acceptance_required');
  }
}

/** Writes require the versions already loaded onto the request. Reads and anonymous requests pass. */
export function enforceRequestTerms(method: string | undefined, player: { termsVersion?: number | null; privacyVersion?: number | null } | undefined): void {
  const verb = (method ?? 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS' || !player) return;
  assertTermsCurrent(player.termsVersion, player.privacyVersion);
}
