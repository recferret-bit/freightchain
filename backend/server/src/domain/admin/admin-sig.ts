/** What an admin's wallet signs on every mutating /api/admin call, one field per line. */
export interface AdminSigParts {
  domain: string;
  wallet: string;
  method: string;
  path: string;
  bodyHash: string;
  nonce: string;
  timestamp: string;
}

/** Five minutes: long enough to submit, short enough that a captured header dies. */
export const ADMIN_SIG_TTL_MS = 5 * 60 * 1000;

export function adminSigText(parts: AdminSigParts): string {
  return [parts.domain, parts.wallet, parts.method.toUpperCase(), parts.path, parts.bodyHash, parts.nonce, parts.timestamp].join('\n');
}
