import { BadRequestError } from '../shared/errors.js';

export const SNS_TLD = '.sol';
export const SNS_ALT_TLD = '.sns';
export const SNS_LABEL_MIN_LENGTH = 1;
export const SNS_LABEL_MAX_LENGTH = 60;
export const SNS_DOMAIN_MAX_LENGTH = 64; // Label (<=60) + ".sol" (4)
export const INVALID_DOMAIN_MESSAGE = 'domain must be a valid .sol domain name';

/**
 * Matches valid domain labels or subdomains:
 * - Lowercase alphanumeric characters, hyphens, and underscores.
 * - Must start and end with an alphanumeric character.
 * - Subdomain labels separated by a single dot.
 * - No consecutive dots, no leading or trailing hyphens or dots.
 */
const DOMAIN_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-_]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-_]*[a-z0-9])?)*$/;

/**
 * Extracts the raw domain label by lowercasing, trimming, and stripping .sol or .sns suffix.
 * e.g. "BONFIDA.SOL" -> "bonfida", "driver-1" -> "driver-1", "alice.sns" -> "alice"
 */
export function extractDomainLabel(value: string): string {
  let cleaned = value.trim().toLowerCase();
  if (cleaned.endsWith('.')) {
    cleaned = cleaned.slice(0, -1);
  }
  if (cleaned.endsWith(SNS_ALT_TLD)) {
    cleaned = cleaned.slice(0, -SNS_ALT_TLD.length);
  } else if (cleaned.endsWith(SNS_TLD)) {
    cleaned = cleaned.slice(0, -SNS_TLD.length);
  }
  return cleaned;
}

/**
 * Normalizes a domain name to its canonical display form with .sol suffix.
 * e.g. " bonfida " -> "bonfida.sol", "ALICE.SOL" -> "alice.sol", "bob.sns" -> "bob.sol"
 */
export function normalizeDomainName(value: string): string {
  const label = extractDomainLabel(value);
  return `${label}${SNS_TLD}`;
}

/**
 * Validates whether an unknown value is a syntactically valid SNS domain name.
 */
export function isDomainName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const label = extractDomainLabel(value);
  if (label.length < SNS_LABEL_MIN_LENGTH || label.length > SNS_LABEL_MAX_LENGTH) {
    return false;
  }
  return DOMAIN_LABEL_REGEX.test(label);
}

/**
 * Parses and returns the canonical domain name (e.g. "bonfida.sol").
 * Throws BadRequestError('domain must be a valid .sol domain name', 'invalid_domain') if invalid.
 */
export function parseDomainName(value: unknown): string {
  if (!isDomainName(value)) {
    throw new BadRequestError(INVALID_DOMAIN_MESSAGE, 'invalid_domain');
  }
  return normalizeDomainName(value);
}

/**
 * Helper to format driver identity: prefers .sol name, falls back to raw wallet.
 */
export function formatDriverDisplay(wallet: string, sns?: string | null): string {
  if (sns && typeof sns === 'string' && sns.trim().length > 0) {
    return sns.trim();
  }
  return wallet;
}
