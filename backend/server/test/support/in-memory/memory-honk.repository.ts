import { HonkRepositoryPort, type HonkAccountRow, type HonkBurnRow, type HonkMintRow, type HonkVisualRow } from '../../../src/application/ports/honk/honk.repository.port.js';
import { HONK_PARTS, type HonkPartSeed } from '../../../src/domain/honk/parts-catalog.js';
import type { MemoryDb } from './memory-db.js';

/** In-memory HONK ledger. The maps live on MemoryDb so a ride summary can count mints. */
export class MemoryHonkRepository extends HonkRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async findMint(rideId: string): Promise<HonkMintRow | null> {
    return this.db.honkMints.get(rideId) ?? null;
  }

  async lockEmission(): Promise<bigint> {
    return this.db.honkEmission;
  }

  async addEmission(amount: bigint): Promise<void> {
    this.db.honkEmission += amount;
  }

  async subEmission(amount: bigint): Promise<void> {
    this.db.honkEmission -= amount;
  }

  async emittedOnDay(start: Date, wallet: string | null): Promise<bigint> {
    const from = start.getTime();
    const to = from + 86_400_000;
    let sum = 0n;
    for (const row of this.db.honkMints.values()) {
      const t = row.createdAt.getTime();
      if (t >= from && t < to && (wallet === null || row.wallet === wallet)) sum += row.amount;
    }
    return sum;
  }

  async insertMint(row: HonkMintRow): Promise<boolean> {
    if (this.db.honkMints.has(row.rideId)) return false;
    this.db.honkMints.set(row.rideId, row);
    return true;
  }

  async markReleased(rideId: string): Promise<boolean> {
    const row = this.db.honkMints.get(rideId);
    if (!row || row.released) return false;
    row.released = true;
    return true;
  }

  async deleteMint(rideId: string): Promise<boolean> {
    const row = this.db.honkMints.get(rideId);
    if (!row || row.released) return false;
    this.db.honkMints.delete(rideId);
    return true;
  }

  async listDue(now: Date, limit: number): Promise<HonkMintRow[]> {
    return [...this.db.honkMints.values()]
      .filter((r) => !r.released && r.releaseAt.getTime() <= now.getTime() && (this.db.players.size === 0 || this.db.players.has(r.wallet)))
      .sort((a, b) => a.releaseAt.getTime() - b.releaseAt.getTime())
      .slice(0, limit);
  }

  async listChainPending(now: Date, limit: number): Promise<HonkMintRow[]> {
    return [...this.db.honkMints.values()].filter((r) => r.released && r.chainPending && (!r.chainRetryAt || r.chainRetryAt <= now)).slice(0, limit);
  }

  async deferChain(rideId: string, until: Date): Promise<void> {
    const row = this.db.honkMints.get(rideId);
    if (row) row.chainRetryAt = until;
  }

  async markChainSent(rideId: string, at: Date): Promise<void> {
    const row = this.db.honkMints.get(rideId);
    if (row) { row.chainPending = false; row.chainSentAt = at; row.chainRetryAt = null; }
  }

  async balance(wallet: string): Promise<bigint> {
    return this.db.honkAccounts.get(wallet)?.balance ?? 0n;
  }

  async account(wallet: string): Promise<HonkAccountRow> {
    return this.db.honkAccounts.get(wallet) ?? { wallet, balance: 0n, minted: 0n, burned: 0n };
  }

  async debit(wallet: string, amount: bigint, at: Date): Promise<boolean> {
    const row = this.accountSync(wallet, at);
    if (row.balance < amount) return false;
    row.balance -= amount;
    row.burned += amount;
    return true;
  }

  async credit(wallet: string, amount: bigint, at: Date): Promise<void> {
    const row = this.accountSync(wallet, at);
    row.balance += amount;
    row.minted += amount;
  }

  async insertBurn(row: HonkBurnRow): Promise<void> {
    this.db.honkBurns.set(row.id, row);
  }

  async reverseBurn(id: string): Promise<void> {
    const row = this.db.honkBurns.get(id);
    if (!row) return;
    const account = this.db.honkAccounts.get(row.wallet);
    if (account) { account.balance += row.amount; account.burned -= row.amount; }
    this.db.honkBurns.delete(id);
  }

  async lastStreamBurn(wallet: string, rideId: string): Promise<Date | null> {
    let last: Date | null = null;
    for (const row of this.db.honkBurns.values()) {
      if (row.wallet === wallet && row.kind === 'stream' && row.ref === rideId && (!last || row.createdAt > last)) last = row.createdAt;
    }
    return last;
  }

  async counts(wallet: string): Promise<{ mints: number; finishes: number }> {
    const rows = [...this.db.honkMints.values()].filter((r) => r.wallet === wallet && r.released && r.amount > 0n);
    return { mints: rows.length, finishes: rows.filter((r) => r.band100).length };
  }

  async visuals(wallet: string): Promise<HonkVisualRow[]> {
    return [...this.db.honkVisuals.values()].filter((r) => r.wallet === wallet);
  }

  async insertVisual(row: HonkVisualRow): Promise<boolean> {
    const key = `${row.wallet}|${row.slot}|${row.item}`;
    if ([...this.db.honkVisuals.values()].some((r) => r.wallet === row.wallet && r.slot === row.slot && r.item === row.item)) return false;
    this.db.honkVisuals.set(key, row);
    return true;
  }

  async listParts(): Promise<HonkPartSeed[]> {
    return HONK_PARTS.slice();
  }

  async findPart(slot: string, item: string): Promise<HonkPartSeed | null> {
    return HONK_PARTS.find((p) => p.slot === slot && p.item === item) ?? null;
  }

  async setVisualChain(id: string, mint: string, signature: string | null): Promise<void> {
    const row = [...this.db.honkVisuals.values()].find((r) => r.id === id);
    if (row) { row.chainMint = mint; row.chainSignature = signature; }
  }

  async deleteVisual(id: string): Promise<void> {
    for (const [key, row] of this.db.honkVisuals) if (row.id === id) this.db.honkVisuals.delete(key);
  }

  private accountSync(wallet: string, at: Date): HonkAccountRow & { updatedAt: Date } {
    const existing = this.db.honkAccounts.get(wallet);
    if (existing) { existing.updatedAt = at; return existing; }
    const created = { wallet, balance: 0n, minted: 0n, burned: 0n, updatedAt: at };
    this.db.honkAccounts.set(wallet, created);
    return created;
  }
}
