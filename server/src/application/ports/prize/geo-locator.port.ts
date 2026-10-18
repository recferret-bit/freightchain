/** Request headers as Express hands them over. The locator reads only the geo names it knows. */
export type GeoHeaders = Record<string, string | string[] | undefined>;

export interface GeoFix {
  /** ISO 3166-1 alpha-2. Null is unknown and cannot enter a ranked start. */
  country: string | null;
  /** Region code from the same edge. Read as a US state only when `country` is US. */
  region: string | null;
}

/** Where a ranked start's country comes from. The default reads edge headers. No paid vendor. */
export abstract class GeoLocatorPort {
  abstract locate(headers: GeoHeaders): GeoFix;
}
