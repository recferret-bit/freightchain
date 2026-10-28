export interface SanctionsResult {
  clean: boolean;
  /** an opaque id of the check (the provider's request id; the local fake's tag) kept in the review row */
  ref: string;
}

/**
 * Sanctions screening of a payout wallet (Chainalysis / OFAC SDN, DEVNET_PRESEASON §14.5). The only adapter today is a deterministic local fake –
 * the live provider is owner-gated (SPC-08.4) and must be a second adapter behind this port, never a call from a handler.
 */
export abstract class SanctionsCheckPort {
  abstract check(wallet: string): Promise<SanctionsResult>;
}
