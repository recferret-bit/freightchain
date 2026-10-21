import { randomUUID } from 'node:crypto';
import { AdminActionRepositoryPort } from '../../src/application/ports/admin/admin-action.repository.port.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { connectedDatabase } from '../../src/infrastructure/prisma/truncate.js';
import { createHarness, type Harness } from '../support/harness.js';
import { T0 } from '../support/db.js';

/** This lane's database only. Never freightchain or freightchain_test. */
const AGENT1 = 'postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test';

describe('admin.AdminAction append-only and AlertOutbox', () => {
  let h: Harness;

  beforeAll(async () => {
    if (process.env['TEST_DATABASE_URL'] && process.env['TEST_DATABASE_URL'] !== AGENT1) throw new Error(`refusing TEST_DATABASE_URL other than freightchain_agent1_test`);
    process.env['TEST_DATABASE_URL'] = AGENT1;
    h = await createHarness('postgres');
  }, 90_000);

  afterAll(() => h?.close());

  it('UPDATE and DELETE fail, and a critical audit writes an alert row', async () => {
    const prisma = h.app.get(PrismaService);
    const name = await connectedDatabase(prisma);
    if (name === 'freightchain' || name === 'freightchain_test') throw new Error(`refusing database ${name}`);
    expect(name).toBe('freightchain_agent1_test');
    const requestId = `wave4-lane1-${randomUUID()}`;
    await h.app.get(AdminActionRepositoryPort).insert({
      wallet: 'wave4-lane1', action: 'verdict.override', target: 'ride-wave4-lane1', role: 'admin',
      detail: { from: 'flagged', to: 'verified' }, requestId, at: T0,
    });
    const alert = await prisma.alertOutbox.findFirst({ where: { requestId, kind: 'verdict.override' } });
    expect(alert).toMatchObject({ money: true, status: 'pending', kind: 'verdict.override' });
    expect(alert?.text).toContain('verdict.override');
    await expect(prisma.$executeRaw`UPDATE "admin"."AdminAction" SET action = 'tamper' WHERE "requestId" = ${requestId}`).rejects.toThrow(/admin_action_append_only/);
    await expect(prisma.$executeRaw`DELETE FROM "admin"."AdminAction" WHERE "requestId" = ${requestId}`).rejects.toThrow(/admin_action_append_only/);
    const row = await prisma.adminAction.findFirst({ where: { requestId } });
    expect(row?.action).toBe('verdict.override');
  });
});
