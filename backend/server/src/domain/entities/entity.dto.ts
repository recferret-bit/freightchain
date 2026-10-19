import type { EntityConfig } from '../shared/entity.js';
import type { EntityRecord, RevisionRecord, RevisionSummary } from './entity.js';

/* What the editor API sends (docs/spec/platform_services.md). Dates are ISO strings. */

export interface EntityBundleDto {
  /** short content hash: changes whenever what players draw changes */
  rev: string;
  entities: EntityConfig[];
}

export interface EntityRowDto {
  id: string;
  kind: string;
  label: string | null;
  /** 'seed' = the code's model, never edited; 'db' = it has revisions */
  source: 'seed' | 'db';
  headRevisionId: string | null;
  publishedRevisionId: string | null;
  headSeq: number | null;
  publishedSeq: number | null;
  updatedAt: string | null;
}

export interface RevisionDto {
  id: string;
  entityId: string;
  seq: number;
  parentId: string | null;
  message: string;
  authorWallet: string;
  jobId: string | null;
  prompt: string | null;
  createdAt: string;
  head: boolean;
  published: boolean;
  source?: string;
  config?: EntityConfig;
  /** the validator's notes on a draft just saved (never a refusal) */
  warnings?: string[];
}

export interface EntityHeadDto {
  row: EntityRowDto;
  source: string;
  config: EntityConfig;
}

export interface PublishedDto {
  /** the new bundle rev */
  rev: string;
}

export function revisionDto(r: RevisionRecord | RevisionSummary, entity: Pick<EntityRecord, 'headRevisionId' | 'publishedRevisionId'> | null, prompt: string | null = null, full = false): RevisionDto {
  const dto: RevisionDto = {
    id: r.id, entityId: r.entityId, seq: r.seq, parentId: r.parentId, message: r.message, authorWallet: r.authorWallet, jobId: r.jobId,
    prompt: 'prompt' in r ? r.prompt : prompt, createdAt: r.createdAt.toISOString(), head: entity?.headRevisionId === r.id, published: entity?.publishedRevisionId === r.id,
  };
  if (full && 'source' in r) { dto.source = r.source; dto.config = r.config; }
  return dto;
}
