/**
 * Application port for Solana Name Service (SNS / .sol) resolution.
 * Implementations query Solana Mainnet-Beta RPC backed by multi-tier caching (Redis/Memory).
 *
 * Fault-tolerance contracts:
 * - Implementations MUST NEVER throw on network failure, timeout, or missing account.
 * - Missing records or errors resolve silently to null (or empty/null batch mappings).
 */
export abstract class NameServicePort {
  /**
   * Reverse lookup: resolves a driver wallet address (base58) to their primary .sol domain name.
   * Returns canonical domain (e.g. "driver.sol") if registered and ownership is verified; null otherwise.
   */
  abstract reverse(wallet: string): Promise<string | null>;

  /**
   * Bulk reverse lookup: resolves an array of wallet addresses in a single batched RPC / cache operation.
   * Returns a Map mapping each wallet address to its primary .sol domain (or null).
   */
  abstract reverseBatch(wallets: readonly string[]): Promise<Map<string, string | null>>;

  /**
   * Forward lookup: resolves a .sol domain name (e.g. "driver.sol" or "driver") to the owner's wallet address.
   * Returns base58 public key string, or null if nonexistent or offline.
   */
  abstract resolve(domain: string): Promise<string | null>;

  /** Convenience alias for reverse(wallet) */
  async reverseLookup(wallet: string): Promise<string | null> {
    return this.reverse(wallet);
  }

  /** Convenience alias for reverseBatch(wallets) */
  async reverseLookupBatch(wallets: readonly string[]): Promise<Map<string, string | null>> {
    return this.reverseBatch(wallets);
  }
}
