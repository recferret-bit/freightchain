import { Injectable } from '@nestjs/common';
import { ConvoyRepositoryPort, type ConvoyLedgerRow, type ConvoyRideRow, type ConvoyRow, type HiddenRead, type ReferrerCounts } from '../../application/referral/convoy.repository.port.js';

/** Unit-test twin; runtime uses ConvoyPrismaRepository. columnPresent also exercises historical missing-column responses. */
@Injectable()
export class MemoryConvoyRepository extends ConvoyRepositoryPort {
  lockPromoBudget(): Promise<void> { return Promise.resolve(); }
  clear(): void { this.rows.clear(); this.ledgerRows.length = 0; this.ledgerIds.clear(); this.rides.clear(); this.hidden.clear(); }
  columnPresent = false;
  private readonly rows = new Map<string, ConvoyRow>();
  private readonly ledgerRows: ConvoyLedgerRow[] = [];
  private readonly ledgerIds = new Set<string>();
  private readonly rides = new Map<string, ConvoyRideRow>();
  private readonly hidden = new Map<string, boolean>();

  privacyColumn(): 'present' | 'missing' {
    return this.columnPresent ? 'present' : 'missing';
  }

  getByReferee(referee: string): Promise<ConvoyRow | null> {
    const row = this.rows.get(referee);
    return Promise.resolve(row ? { ...row } : null);
  }

  listByReferrer(referrer: string): Promise<ConvoyRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.referrer === referrer).map((row) => ({ ...row })));
  }

  insert(row: ConvoyRow): Promise<boolean> {
    if (this.rows.has(row.referee)) return Promise.resolve(false);
    this.rows.set(row.referee, { ...row });
    return Promise.resolve(true);
  }

  save(row: ConvoyRow): Promise<void> {
    this.rows.set(row.referee, { ...row });
    return Promise.resolve();
  }

  deleteReferee(referee: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(referee));
  }

  listPendingExpired(now: Date): Promise<ConvoyRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.status === 'pending' && row.expiresAt.getTime() < now.getTime()).map((row) => ({ ...row })));
  }

  listActivePast(now: Date): Promise<ConvoyRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.status === 'active' && row.m1At === null && row.qualifyExpiresAt !== null && row.qualifyExpiresAt.getTime() < now.getTime()).map((row) => ({ ...row })));
  }

  insertLedger(row: ConvoyLedgerRow): Promise<boolean> {
    if (this.ledgerIds.has(row.id)) return Promise.resolve(false);
    this.ledgerIds.add(row.id);
    this.ledgerRows.push({ ...row });
    return Promise.resolve(true);
  }

  override releaseLedger(id: string, at: Date): Promise<boolean> {
    const row = this.ledgerRows.find((item) => item.id === id);
    if (!row || row.releasedAt) return Promise.resolve(false);
    row.releasedAt = at;
    return Promise.resolve(true);
  }

  ledger(): Promise<ConvoyLedgerRow[]> {
    return Promise.resolve(this.ledgerRows.map((row) => ({ ...row })));
  }

  recordRide(row: ConvoyRideRow): Promise<void> {
    if (!this.rides.has(row.rideId)) this.rides.set(row.rideId, { ...row });
    return Promise.resolve();
  }

  ridesOf(wallet: string): Promise<ConvoyRideRow[]> {
    return Promise.resolve([...this.rides.values()].filter((row) => row.wallet === wallet).map((row) => ({ ...row })));
  }

  referrerCounts(): Promise<ReferrerCounts[]> {
    const map = new Map<string, ReferrerCounts>();
    for (const row of this.rows.values()) {
      if (row.status !== 'qualified' && row.status !== 'active') continue;
      const cur = map.get(row.referrer) ?? { referrer: row.referrer, qualified: 0, active: 0 };
      if (row.status === 'qualified') cur.qualified += 1;
      else cur.active += 1;
      map.set(row.referrer, cur);
    }
    return Promise.resolve([...map.values()]);
  }

  readHidden(wallet: string): Promise<HiddenRead> {
    if (!this.columnPresent) return Promise.resolve({ columnPresent: false, hidden: false });
    return Promise.resolve({ columnPresent: true, hidden: this.hidden.get(wallet) === true });
  }

  writeHidden(wallet: string, hidden: boolean): Promise<HiddenRead> {
    if (!this.columnPresent) return Promise.resolve({ columnPresent: false, hidden: false });
    this.hidden.set(wallet, hidden);
    return Promise.resolve({ columnPresent: true, hidden });
  }
}
