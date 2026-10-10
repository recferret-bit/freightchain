import { Injectable } from '@nestjs/common';
import { OfflineRideRepositoryPort, type OfflineClaimInput, type OfflineClaimResult } from '../../../src/application/ports/offline/offline-ride.repository.port.js';
import { SettingsRepositoryPort } from '../../../src/application/ports/settings/settings.repository.port.js';
import type { MemoryDb } from './memory-db.js';

@Injectable()
export class MemorySettingsRepository extends SettingsRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }

  async all(): Promise<readonly { key: string; value: number }[]> {
    return [...this.db.settings.entries()].map(([key, value]) => ({ key, value }));
  }

  async upsert(key: string, value: number): Promise<void> {
    this.db.settings.set(key, value);
  }
}

/** A promise queue so two in-flight claims cannot both pass the count check. The PostgreSQL twin uses advisory locks. */
@Injectable()
export class MemoryOfflineRideRepository extends OfflineRideRepositoryPort {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly db: MemoryDb) { super(); }

  async counts(fingerprint: string, ip: string): Promise<{ usedFingerprint: number; usedIp: number }> {
    return {
      usedFingerprint: this.db.offlineUses.filter((row) => row.fingerprint === fingerprint).length,
      usedIp: this.db.offlineUses.filter((row) => row.ip === ip).length,
    };
  }

  tryClaim(input: OfflineClaimInput): Promise<OfflineClaimResult> {
    const run = this.tail.then(() => this.claimNow(input));
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private claimNow(input: OfflineClaimInput): OfflineClaimResult {
    const usedFingerprint = this.db.offlineUses.filter((row) => row.fingerprint === input.fingerprint).length;
    const usedIp = this.db.offlineUses.filter((row) => row.ip === input.ip).length;
    if (usedFingerprint >= input.limitFingerprint || usedIp >= input.limitIp) return { granted: false, usedFingerprint, usedIp };
    this.db.offlineUses.push({ id: input.id, fingerprint: input.fingerprint, ip: input.ip, at: input.at });
    return { granted: true, usedFingerprint: usedFingerprint + 1, usedIp: usedIp + 1 };
  }
}
