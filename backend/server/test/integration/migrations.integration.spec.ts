import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { testDatabaseUrl } from '../support/harness.js';
import { SERVER_DIR } from '../architecture/source-files.js';

/* The migrations in prisma/migrations, applied to a real database, must produce EXACTLY the schema prisma/*.prisma declares – the silent breakage the
   generated client can never show (it typechecks and every in-memory test passes while the real database is wrong). */
const url = testDatabaseUrl();
const prisma = (...args: string[]) => spawnSync(join(SERVER_DIR, 'node_modules', '.bin', 'prisma'), args, { cwd: SERVER_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });

describe('migrations vs the Prisma schema (PostgreSQL)', () => {
  it('every migration is applied', () => {
    const status = prisma('migrate', 'status');
    expect(status.stdout + status.stderr).toMatch(/Database schema is up to date/);
  });

  it('the database has no drift from the schema files (an empty diff)', () => {
    const diff = prisma('migrate', 'diff', '--from-url', url, '--to-schema-datamodel', 'prisma', '--exit-code');
    expect(diff.status, diff.stdout + diff.stderr).toBe(0);
  });
});
