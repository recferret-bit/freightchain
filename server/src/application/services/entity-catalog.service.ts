import { Injectable } from '@nestjs/common';
import { SEED_ENTITIES, type EntityConfig } from '../../domain/shared/entity.js';
import { seedSource, type EntityRecord, type RevisionRecord } from '../../domain/entities/entity.js';
import type { EntityBundleDto, EntityRowDto } from '../../domain/entities/entity.dto.js';
import { EntityRepositoryPort } from '../ports/entities/entity.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { HasherPort } from '../ports/shared/hasher.port.js';

/** how long a built bundle is served before one cheap query asks whether anything was published elsewhere (another process) */
export const BUNDLE_RECHECK_MS = 10_000;

export interface EntityHead {
  config: EntityConfig;
  source: string;
  revision: RevisionRecord | null;
  record: EntityRecord | null;
}

/**
 * The catalogue of 3D models = the code's seed (client/shared/entity/seed/) with the database on top.
 *  - `bundle()`: what every player draws – the seed with every PUBLISHED revision on top, held in memory (built once per publish; at most every
 *    BUNDLE_RECHECK_MS it asks the database for the publish fingerprint, so other processes converge). No request of the game reaches the database otherwise.
 *  - `heads()`: what the editor works on – the seed with every HEAD revision on top (the validator's lookup).
 */
@Injectable()
export class EntityCatalogService {
  private readonly seed = new Map<string, EntityConfig>(SEED_ENTITIES.map((e) => [e.id, e]));
  private readonly seedHash = new Map<string, string>();
  private cached: { dto: EntityBundleDto; stamp: string; checkedAt: number } | null = null;

  constructor(
    private readonly entities: EntityRepositoryPort,
    private readonly hasher: HasherPort,
    private readonly clock: ClockPort,
  ) {}

  seedOf(id: string): EntityConfig | null { return this.seed.get(id) ?? null; }

  async bundle(): Promise<EntityBundleDto> {
    const now = this.clock.now().getTime();
    if (this.cached && now - this.cached.checkedAt < BUNDLE_RECHECK_MS) return this.cached.dto;
    const stamp = await this.entities.publishedStamp();
    if (this.cached && this.cached.stamp === stamp) { this.cached.checkedAt = now; return this.cached.dto; }
    const merged = new Map<string, { config: EntityConfig; hash: string }>();
    for (const [id, config] of this.seed) merged.set(id, { config, hash: this.hashOfSeed(id, config) });
    for (const r of await this.entities.published()) merged.set(r.entityId, { config: r.config, hash: r.hash });
    const ids = [...merged.keys()].sort();
    const rev = this.hasher.sha256Hex(ids.map((id) => `${id}:${merged.get(id)!.hash}`).join('\n')).slice(0, 16);
    const dto = { rev, entities: ids.map((id) => merged.get(id)!.config) };
    this.cached = { dto, stamp, checkedAt: now };
    return dto;
  }

  /** after a publish in this process: the next bundle() rebuilds at once */
  invalidate(): void { this.cached = null; }

  async heads(): Promise<Map<string, EntityHead>> {
    const out = new Map<string, EntityHead>();
    for (const [id, config] of this.seed) out.set(id, { config, source: seedSource(config), revision: null, record: null });
    const records = new Map((await this.entities.list()).map((e) => [e.id, e]));
    for (const r of await this.entities.heads()) out.set(r.entityId, { config: r.config, source: r.source, revision: r, record: records.get(r.entityId) ?? null });
    return out;
  }

  async rows(): Promise<EntityRowDto[]> {
    const records = await this.entities.list(), seqs = await this.entities.seqs(records.flatMap((e) => [e.headRevisionId, e.publishedRevisionId].filter((v): v is string => !!v)));
    const byId = new Map(records.map((e) => [e.id, e]));
    const ids = [...new Set([...this.seed.keys(), ...byId.keys()])].sort();
    return ids.map((id) => {
      const e = byId.get(id), s = this.seed.get(id);
      return e
        ? { id, kind: e.kind, label: e.label, source: 'db' as const, headRevisionId: e.headRevisionId, publishedRevisionId: e.publishedRevisionId, headSeq: e.headRevisionId ? seqs.get(e.headRevisionId) ?? null : null, publishedSeq: e.publishedRevisionId ? seqs.get(e.publishedRevisionId) ?? null : null, updatedAt: e.updatedAt.toISOString() }
        : { id, kind: s!.kind, label: s!.label ?? null, source: 'seed' as const, headRevisionId: null, publishedRevisionId: null, headSeq: null, publishedSeq: null, updatedAt: null };
    });
  }

  private hashOfSeed(id: string, config: EntityConfig): string {
    let h = this.seedHash.get(id);
    if (!h) { h = this.hasher.sha256Hex(seedSource(config)); this.seedHash.set(id, h); }
    return h;
  }
}
