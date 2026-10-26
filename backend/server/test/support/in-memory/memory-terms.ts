import { TermsAcceptanceRepositoryPort, type TermsAcceptanceRecord } from '../../../src/application/ports/players/terms-acceptance.repository.port.js';
import type { MemoryDb } from './memory-db.js';
export class MemoryTermsAcceptanceRepository extends TermsAcceptanceRepositoryPort {
  constructor(private readonly db: MemoryDb) { super(); }
  async insert(record: TermsAcceptanceRecord): Promise<void> {
    if (!this.db.termsAcceptances.some(row => row.wallet === record.wallet && row.termsVersion === record.termsVersion && row.privacyVersion === record.privacyVersion)) this.db.termsAcceptances.push(structuredClone(record));
  }
}
