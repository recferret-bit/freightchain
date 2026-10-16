import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ID, KINDS } from '../domain/shared/entity.js';
import type { EnvService } from '../infrastructure/config/env.service.js';

export interface PublishedFile { entityId: string; kind: string; source: string; seq: number }

/** Where each published revision goes in the code's seed: client/shared/entity/seed/<kind>/<id>.js (the file text as stored – canonical). */
export function seedFiles(clientDir: string, published: readonly PublishedFile[]): { path: string; source: string; label: string }[] {
  const root = resolve(clientDir, 'shared', 'entity', 'seed');
  return published.map((p) => {
    if (!ID.test(p.entityId) || !(KINDS as readonly string[]).includes(p.kind)) throw new Error(`bad seed path for '${p.kind}/${p.entityId}'`);
    const path = join(clientDir, 'shared', 'entity', 'seed', p.kind, `${p.entityId}.js`);
    if (!resolve(path).startsWith(root + sep)) throw new Error(`seed path outside ${root}`);
    return { path, source: p.source, label: `${p.kind}/${p.entityId} #${p.seq}` };
  });
}

/**
 * `entities:export`: every PUBLISHED revision of the database written back over the code's seed files, then seed/index.js regenerated – so what the
 * players draw can be reviewed and committed in git (and a fresh database serves it as the seed). Reads only; writes files under CLIENT_DIR.
 */
export async function runEntitiesExport(env: EnvService): Promise<number> {
  const prisma = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });
  try {
    const rows = await prisma.entity.findMany({ where: { publishedRevisionId: { not: null } }, select: { id: true, kind: true, publishedRevisionId: true } });
    const revs = await prisma.entityRevision.findMany({ where: { id: { in: rows.map((r) => r.publishedRevisionId!) } }, select: { id: true, entityId: true, source: true, seq: true } });
    const kindOf = new Map(rows.map((r) => [r.id, r.kind]));
    const files = seedFiles(env.clientDir, revs.map((r) => ({ entityId: r.entityId, kind: kindOf.get(r.entityId)!, source: r.source, seq: r.seq })));
    for (const f of files) { mkdirSync(join(f.path, '..'), { recursive: true }); writeFileSync(f.path, f.source); console.log(`[cli] wrote ${f.label}`); }
    const indexer = join(env.clientDir, 'tools', 'entity-seed-index.mjs');
    if (existsSync(indexer)) spawnSync(process.execPath, [indexer], { stdio: 'inherit' });
    else console.warn('[cli] client/tools/entity-seed-index.mjs is not here – run it in a checkout to refresh seed/index.js');
    console.log(`[cli] ${files.length} published entit${files.length === 1 ? 'y' : 'ies'} exported to ${join(env.clientDir, 'shared', 'entity', 'seed')}`);
    return 0;
  } catch (error) {
    console.error(`[cli] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}
