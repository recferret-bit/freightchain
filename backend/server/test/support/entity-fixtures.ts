import { printSource } from '../../src/domain/shared/entity.js';
import { SEED_ENTITIES, type EntityConfig } from '../../src/domain/shared/entity.js';
import { EntityCatalogService } from '../../src/application/services/entity-catalog.service.js';
import { EntityWriteService } from '../../src/application/services/entity-write.service.js';
import type { RulesConfig } from '../../src/application/ports/config/rules-config.port.js';
import { MemoryEntityRepository } from './in-memory/memory-entities.js';
import { unitContext, unitRules } from './unit-context.js';

/** a seed entity's config (deep copy) – edit it and print it to make a draft */
export const seedEntity = (id: string): EntityConfig => structuredClone(SEED_ENTITIES.find((e) => e.id === id)!);
/** the cactus with a fatter trunk: a valid draft that is not the seed */
export const fatCactus = (scale = 0.4): string => {
  const c = seedEntity('cactus'); (c['parts'] as { s: unknown[] }[])[0]!.s[0] = scale; (c['parts'] as { s: unknown[] }[])[0]!.s[2] = scale; return printSource(c);
};

/** the unit context plus the entity history on in-memory ports */
export function entityContext(rules: RulesConfig = unitRules()) {
  const ctx = unitContext(rules);
  const entities = new MemoryEntityRepository(ctx.db);
  const catalog = new EntityCatalogService(entities, ctx.hasher, ctx.clock);
  const write = new EntityWriteService(entities, catalog, ctx.transactions, ctx.hasher, ctx.entropy, ctx.clock);
  return { ...ctx, entities, catalog, write };
}
