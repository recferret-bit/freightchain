/** The periodic truth check (docs/agents/escrow.md "PoolSyncService"): every open / active pool of the mirror re-read from its account. */
export class SyncPoolsCommand {}

export interface PoolDriftDto {
  poolId: number;
  /** "field: mirror → chain" for every field the events had not brought in line (the chain wins) */
  changes: string[];
}

export interface SyncPoolsResultDto {
  synced: number;
  drifted: PoolDriftDto[];
  /** pools in the mirror without an account on chain (development seeds, or a wrong program id) – left as they are */
  missing: number[];
}
