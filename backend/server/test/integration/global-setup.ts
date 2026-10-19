import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { SERVER_DIR } from '../architecture/source-files.js';
import { databaseNameOf } from '../../src/infrastructure/prisma/truncate.js';
import { HONK_PARTS } from '../../src/domain/honk/parts-catalog.js';
import { testDatabaseUrl } from '../support/harness.js';

/** Runs once before the integration suite: the suite wipes its database before every test, so it gets a database of its OWN (`*_test`, in the same container):
    create it if it is missing (an existing volume never re-runs init scripts), then apply the migrations to it. The developer's database is never touched. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const name = databaseNameOf(url);
  if (!name.endsWith('_test')) throw new Error(`the integration database must be named *_test, got "${name}" – set TEST_DATABASE_URL accordingly`);
  const admin = new PrismaClient({ datasources: { db: { url: url.replace(/\/[^/?]+(\?|$)/, '/postgres$1') } } }); // the server's maintenance database
  try {
    const found = await admin.$queryRaw<{ one: number }[]>`SELECT 1 AS one FROM pg_database WHERE datname = ${name}`;
    if (found.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }
  const migrate = spawnSync(join(SERVER_DIR, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], { cwd: SERVER_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
  if (migrate.status !== 0) throw new Error(`prisma migrate deploy failed on ${name}:\n${migrate.stdout}${migrate.stderr}`);
  const testDb = new PrismaClient({ datasources: { db: { url } } });
  try {
    await testDb.honkPart.createMany({ data: [...HONK_PARTS], skipDuplicates: true });
  } finally {
    await testDb.$disconnect();
  }
}
