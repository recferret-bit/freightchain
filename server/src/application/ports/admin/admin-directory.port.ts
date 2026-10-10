import type { StatsTotals } from '../../../domain/stats/stats.js';
import type { AdminPlayerRowDto, AdminPoolDetailDto, AdminPoolRowDto, AdminSessionsDto } from '../../../domain/admin/admin.dto.js';

/** The admin page's directory reads (players, pools, top riders): projections no aggregate needs. Read-only – every change goes through the aggregates' own ports. */
export abstract class AdminDirectoryPort {
  /** newest first; `q` = a wallet prefix (case-sensitive, base58) */
  abstract players(q: string | undefined, limit: number): Promise<AdminPlayerRowDto[]>;
  /** newest first */
  abstract pools(limit: number): Promise<AdminPoolRowDto[]>;
  abstract pool(id: number): Promise<AdminPoolDetailDto | null>;
  /** one row per wallet with a sign-in at or after `since`, newest first, at most `limit` (`truncated` = there were more) – aggregated by the database, never by scanning the log in memory */
  abstract sessions(since: Date, limit: number): Promise<AdminSessionsDto>;
  /** riders by metres driven, most first */
  abstract topRiders(limit: number): Promise<{ wallet: string; totals: StatsTotals }[]>;
}
