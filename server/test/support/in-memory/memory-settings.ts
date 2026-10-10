import { Injectable } from '@nestjs/common';
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
