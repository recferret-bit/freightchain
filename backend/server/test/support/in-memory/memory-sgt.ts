import { SgtRepositoryPort, type SgtClaim } from '../../../src/application/trust/sgt.port.js';
export class MemorySgtRepository extends SgtRepositoryPort {
  rows = new Map<string, SgtClaim>();
  async byWallet(wallet: string): Promise<SgtClaim | null> { return structuredClone([...this.rows.values()].find(r => r.wallet === wallet) ?? null); }
  async claim(row: SgtClaim): Promise<boolean> {
    if (this.rows.has(row.mint) || [...this.rows.values()].some(r => r.wallet === row.wallet)) return false;
    this.rows.set(row.mint, structuredClone(row)); return true;
  }
}
