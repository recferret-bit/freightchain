import type { EntityRecord, RevisionRecord, RevisionSummary } from '../../../domain/entities/entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

/**
 * `asset.Entity` + `asset.EntityRevision`: the editor's history of the 3D models (the code's seed is not here until an entity is first edited).
 * Revisions are append-only; only the entity row's pointers move, under its row lock (`lock`).
 */
export abstract class EntityRepositoryPort {
  abstract list(tx?: TransactionHandle): Promise<EntityRecord[]>;
  abstract find(id: string, tx?: TransactionHandle): Promise<EntityRecord | null>;
  /** inserts the row unless it exists (two first edits of one entity race here – both then queue on `lock`) */
  abstract ensure(record: EntityRecord, tx: TransactionHandle): Promise<void>;
  /** SELECT … FOR UPDATE: the one lock of an entity write */
  abstract lock(id: string, tx: TransactionHandle): Promise<EntityRecord | null>;
  abstract appendRevision(revision: RevisionRecord, tx: TransactionHandle): Promise<void>;
  /** the next seq of an entity (call under its lock) */
  abstract nextSeq(entityId: string, tx: TransactionHandle): Promise<number>;
  /** moves HEAD and / or PUBLISHED (published also stamps publishedAt), bumps version */
  abstract setPointers(id: string, pointers: { headRevisionId?: string; publishedRevisionId?: string }, at: Date, tx: TransactionHandle): Promise<void>;
  abstract revision(id: string, tx?: TransactionHandle): Promise<RevisionRecord | null>;
  /** newest first, without source / config, each with the prompt of the job that made it */
  abstract revisions(entityId: string): Promise<RevisionSummary[]>;
  /** seq of each of these revision ids (a row's head / published numbers) */
  abstract seqs(ids: readonly string[]): Promise<Map<string, number>>;
  /** every entity's HEAD revision (the validator's lookup, the editor's list) */
  abstract heads(): Promise<RevisionRecord[]>;
  /** every PUBLISHED revision (the game's bundle). Pass `tx` to read on the connection that holds `lockPublish`. */
  abstract published(tx?: TransactionHandle): Promise<RevisionRecord[]>;
  /** one lock for the whole catalogue, so two publishes cannot each miss the other's commit */
  abstract lockPublish(tx: TransactionHandle): Promise<void>;
  /** a cheap fingerprint of what is published (changes whenever a publish happens anywhere) */
  abstract publishedStamp(): Promise<string>;
}
