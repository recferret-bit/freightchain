import { Injectable } from '@nestjs/common';
import { assertSameKind, checkEntitySource, SEED_AUTHOR, seedSource, type EntityRecord, type RevisionRecord } from '../../domain/entities/entity.js';
import { revisionDto, type RevisionDto } from '../../domain/entities/entity.dto.js';
import { ConflictError, NotFoundError } from '../../domain/shared/errors.js';
import { EntityRepositoryPort } from '../ports/entities/entity.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EntropyPort } from '../ports/shared/entropy.port.js';
import { HasherPort } from '../ports/shared/hasher.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { EntityCatalogService } from './entity-catalog.service.js';

export interface DraftInput {
  entityId: string;
  source: string;
  message: string;
  /** the HEAD the author edited (null = the seed / a new entity); anything else is a 409 stale_base */
  baseRevisionId: string | null;
  author: string;
  jobId?: string | null;
}

/**
 * Every write of the 3D model history (the editor's own saves, restores and – later – the AI editor's drafts): the file is read without executing it and
 * validated against the other entities' heads BEFORE any lock; then, in ONE transaction under the entity row's lock (the only lock: `ensure` + `lock`),
 * the base is checked against the head, the revision appended (seq = max + 1; an entity's first edit first records the code's seed as #1) and HEAD moved.
 * Nothing here touches what players draw – that is PublishRevisionHandler.
 */
@Injectable()
export class EntityWriteService {
  constructor(
    private readonly entities: EntityRepositoryPort,
    private readonly catalog: EntityCatalogService,
    private readonly transactions: TransactionPort,
    private readonly hasher: HasherPort,
    private readonly entropy: EntropyPort,
    private readonly clock: ClockPort,
  ) {}

  async saveDraft(input: DraftInput): Promise<RevisionDto> {
    const heads = await this.catalog.heads();
    const { config, source, warnings } = checkEntitySource(input.source, input.entityId, (id) => heads.get(id)?.config);
    const seed = this.catalog.seedOf(input.entityId), now = this.clock.now();
    const hash = this.hasher.sha256Hex(source);
    const { revision, row } = await this.transactions.run(async (tx) => {
      await this.entities.ensure({ id: input.entityId, kind: config.kind, label: config.label ?? null, headRevisionId: null, publishedRevisionId: null, version: 0, createdBy: seed ? SEED_AUTHOR : input.author, createdAt: now, updatedAt: now }, tx);
      const row = await this.locked(input.entityId, tx);
      assertSameKind(row, config, seed);
      this.assertBase(row, input.baseRevisionId);
      const parentId = row.headRevisionId ?? (seed ? (await this.append(row.id, { source: seedSource(seed), config: seed, author: SEED_AUTHOR, message: 'the code\'s model (seed)', parentId: null, jobId: null }, now, tx)).id : null);
      const revision = await this.append(row.id, { source, config, author: input.author, message: input.message, parentId, jobId: input.jobId ?? null, hash }, now, tx);
      await this.entities.setPointers(row.id, { headRevisionId: revision.id }, now, tx);
      return { revision, row: { ...row, headRevisionId: revision.id } };
    });
    return { ...revisionDto(revision, row, null, true), warnings };
  }

  /** a NEW head that copies an older revision of the same entity (append-only), re-validated against today's catalogue */
  async restore(entityId: string, revisionId: string, baseRevisionId: string | null, author: string): Promise<RevisionDto> {
    const old = await this.entities.revision(revisionId);
    if (!old || old.entityId !== entityId) throw new NotFoundError('no such revision of this entity', 'revision_not_found');
    const heads = await this.catalog.heads();
    const { config, source } = checkEntitySource(old.source, entityId, (id) => heads.get(id)?.config);
    const now = this.clock.now();
    const { revision, row } = await this.transactions.run(async (tx) => {
      const row = await this.locked(entityId, tx);
      this.assertBase(row, baseRevisionId);
      const revision = await this.append(entityId, { source, config, author, message: `restore of #${old.seq}`, parentId: row.headRevisionId, jobId: null, hash: old.hash }, now, tx);
      await this.entities.setPointers(entityId, { headRevisionId: revision.id }, now, tx);
      return { revision, row: { ...row, headRevisionId: revision.id } };
    });
    return revisionDto(revision, row, null, true);
  }

  private async locked(id: string, tx: TransactionHandle): Promise<EntityRecord> {
    const row = await this.entities.lock(id, tx);
    if (!row) throw new NotFoundError('no such entity', 'entity_not_found');
    return row;
  }

  private assertBase(row: EntityRecord, base: string | null): void {
    if ((base ?? null) !== row.headRevisionId) throw new ConflictError('someone saved this model since you opened it – reload it and apply your change again', 'stale_base');
  }

  private async append(entityId: string, r: { source: string; config: RevisionRecord['config']; author: string; message: string; parentId: string | null; jobId: string | null; hash?: string }, now: Date, tx: TransactionHandle): Promise<RevisionRecord> {
    const revision: RevisionRecord = {
      id: this.entropy.uuid(), entityId, seq: await this.entities.nextSeq(entityId, tx), parentId: r.parentId, source: r.source, config: r.config,
      hash: r.hash ?? this.hasher.sha256Hex(r.source), authorWallet: r.author, jobId: r.jobId, message: r.message, createdAt: now,
    };
    await this.entities.appendRevision(revision, tx);
    return revision;
  }
}
