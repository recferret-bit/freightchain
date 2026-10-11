import { NameServicePort } from '../../src/application/ports/sns/name-service.port.js';

export class StubNameServiceAdapter extends NameServicePort {
  readonly forwardMap = new Map<string, string>();
  readonly reverseMap = new Map<string, string>();

  calls = {
    resolve: 0,
    reverse: 0,
    reverseBatch: 0,
    reverseLookup: 0,
    reverseLookupBatch: 0,
  };

  errorOnResolve: Error | null = null;
  errorOnReverse: Error | null = null;
  delayMs = 0;

  constructor(initialMappings?: { forward?: Record<string, string>; reverse?: Record<string, string> }) {
    super();
    if (initialMappings?.forward) {
      for (const [domain, wallet] of Object.entries(initialMappings.forward)) {
        this.setRecord(domain, wallet);
      }
    }
    if (initialMappings?.reverse) {
      for (const [wallet, domain] of Object.entries(initialMappings.reverse)) {
        this.setReverse(wallet, domain);
      }
    }
  }

  setRecord(domain: string, wallet: string): this {
    const label = domain.trim().toLowerCase().replace(/\.(sol|sns)$/, '');
    const fullName = `${label}.sol`;
    this.forwardMap.set(label, wallet);
    this.reverseMap.set(wallet, fullName);
    return this;
  }

  setReverse(wallet: string, domain: string): this {
    const label = domain.trim().toLowerCase().replace(/\.(sol|sns)$/, '');
    this.reverseMap.set(wallet, `${label}.sol`);
    return this;
  }

  setForward(domain: string, wallet: string): this {
    const label = domain.trim().toLowerCase().replace(/\.(sol|sns)$/, '');
    this.forwardMap.set(label, wallet);
    return this;
  }

  async resolve(domain: string): Promise<string | null> {
    this.calls.resolve++;
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.errorOnResolve) throw this.errorOnResolve;
    if (!domain) return null;
    const label = domain.trim().toLowerCase().replace(/\.(sol|sns)$/, '');
    return this.forwardMap.get(label) ?? null;
  }

  async reverse(wallet: string): Promise<string | null> {
    this.calls.reverse++;
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.errorOnReverse) throw this.errorOnReverse;
    return this.reverseMap.get(wallet) ?? null;
  }

  async reverseBatch(wallets: readonly string[]): Promise<Map<string, string | null>> {
    this.calls.reverseBatch++;
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.errorOnReverse) throw this.errorOnReverse;
    const result = new Map<string, string | null>();
    for (const w of wallets) {
      result.set(w, this.reverseMap.get(w) ?? null);
    }
    return result;
  }

  override async reverseLookup(wallet: string): Promise<string | null> {
    this.calls.reverseLookup++;
    return this.reverse(wallet);
  }

  override async reverseLookupBatch(wallets: readonly string[]): Promise<Map<string, string | null>> {
    this.calls.reverseLookupBatch++;
    return this.reverseBatch(wallets);
  }

  clear(): void {
    this.reset();
  }

  reset(): void {
    this.forwardMap.clear();
    this.reverseMap.clear();
    this.calls = { resolve: 0, reverse: 0, reverseBatch: 0, reverseLookup: 0, reverseLookupBatch: 0 };
    this.errorOnResolve = null;
    this.errorOnReverse = null;
    this.delayMs = 0;
  }
}

// Backward-compatible alias
export { StubNameServiceAdapter as FakeNameService };
