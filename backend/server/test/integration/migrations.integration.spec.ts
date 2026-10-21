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
    const text = `${diff.stdout}\n${diff.stderr}`;
    // Prisma's schema has no place for the append-only trigger, so the only allowed drift is that trigger and its function.
    const extra = text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('--') && !/admin_action_append_only/.test(line));
    expect(diff.status === 0 || extra.length === 0, text).toBe(true);
  });
});
