/**
 * Result of a reverse SNS lookup: maps a wallet address to its primary .sol domain.
 */
export interface SnsReverseDto {
  /** The queried driver wallet address (base58) */
  wallet: string;
  /** Primary .sol domain name (e.g. "driver.sol"), or null if none registered or stale */
  domain: string | null;
}

/**
 * Result of a forward SNS resolution: maps a domain name to its owning wallet address.
 */
export interface SnsResolutionDto {
  /** Canonical domain name (e.g. "driver.sol") */
  domain: string;
  /** Resolved owner wallet address (base58), or null if nonexistent */
  wallet: string | null;
}

/**
 * Validated forward SNS record mapping.
 */
export interface SnsRecord {
  domain: string;
  wallet: string;
}

/**
 * Batch reverse lookup result map: wallet -> primary domain (or null).
 */
export type SnsReverseBatchResult = Map<string, string | null>;
