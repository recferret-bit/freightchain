import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SERVER_DIR, sourceFiles } from './source-files.js';

/*
 * The test pyramid, enforced (controller > CQRS handler > service > repository):
 *   every controller, CQRS handler, service, guard, interceptor, filter and adapter (anything Nest instantiates) has its OWN unit spec – test/unit/**\/<file>.spec.ts –
 *   and everything that talks to PostgreSQL (Prisma repositories, the transaction adapter, the health probe, PrismaService) has its OWN integration spec –
 *   test/integration/**\/<file>.integration.spec.ts – against a real database. On top: the HTTP scenarios (in-memory + PostgreSQL) and the concurrency suite.
 * A new class without its spec fails here. There is no allow-list.
 */
function specsUnder(dir: string): Set<string> {
  const found = new Set<string>();
  const walk = (d: string) => readdirSync(d).forEach((name) => { const full = join(d, name); if (statSync(full).isDirectory()) walk(full); else found.add(name); });
  walk(join(SERVER_DIR, dir));
  return found;
}
const unitSpecs = specsUnder('test/unit');
const integrationSpecs = specsUnder('test/integration');

const NEST_CLASS = /@(Injectable|Controller|CommandHandler|QueryHandler|Catch)\(/;
const TALKS_TO_POSTGRES = (path: string, text: string) => path.startsWith('infrastructure/prisma/') || /PrismaService/.test(text) && path.startsWith('infrastructure/');
const nestClasses = sourceFiles().filter((f) => NEST_CLASS.test(f.text));
const needsIntegration = nestClasses.filter((f) => TALKS_TO_POSTGRES(f.path, f.text));
const needsUnit = nestClasses.filter((f) => !needsIntegration.includes(f));
const stem = (path: string) => basename(path, '.ts');

describe('test pyramid completeness', () => {
  it('finds every layer of the pyramid', () => {
    expect(needsUnit.filter((f) => f.path.endsWith('.http.controller.ts')).length).toBeGreaterThanOrEqual(5);
    expect(needsUnit.filter((f) => f.path.endsWith('.handler.ts')).length).toBeGreaterThanOrEqual(20);
    expect(needsUnit.filter((f) => f.path.endsWith('.service.ts')).length).toBeGreaterThanOrEqual(5);
    expect(needsIntegration.filter((f) => f.path.endsWith('.prisma.repository.ts')).length).toBeGreaterThanOrEqual(7);
  });

  it('every controller, handler, service, guard, interceptor, filter and adapter has its own unit spec', () => {
    const missing = needsUnit.filter((f) => !unitSpecs.has(`${stem(f.path)}.spec.ts`)).map((f) => f.path);
    expect(missing).toEqual([]);
  });

  it('every class that talks to PostgreSQL has its own integration spec against a real database', () => {
    const missing = needsIntegration.filter((f) => !integrationSpecs.has(`${stem(f.path)}.integration.spec.ts`)).map((f) => f.path);
    expect(missing).toEqual([]);
  });

  it('pure modules with logic have their spec too (domain entities and rules, mappers, the problem mapping, env schema, throttling)', () => {
    for (const path of ['domain/rides/ride.entity.ts', 'domain/players/player.entity.ts', 'infrastructure/solana/chain-transaction.mapper.ts', 'infrastructure/http/filters/problem-mapping.ts', 'infrastructure/config/env.schema.ts', 'infrastructure/http/throttling.ts']) {
      expect(unitSpecs.has(`${stem(path)}.spec.ts`), path).toBe(true);
    }
  });
});
