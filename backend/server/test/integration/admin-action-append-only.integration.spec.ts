import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { T0, testPrisma, wipe } from '../support/db.js';

describe('admin.AdminAction is append-only', () => {
  let prisma: PrismaService;
  beforeAll(async () => { prisma = await testPrisma(); });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => wipe(prisma));

  it('UPDATE and DELETE raise admin_action_append_only', async () => {
    await prisma.adminAction.create({ data: { wallet: 'A', action: 'auth.signin', target: 'A', detail: {}, at: T0 } });
    await expect(prisma.$executeRaw`UPDATE "admin"."AdminAction" SET action = 'tamper'`).rejects.toThrow(/admin_action_append_only/);
    await expect(prisma.$executeRaw`DELETE FROM "admin"."AdminAction"`).rejects.toThrow(/admin_action_append_only/);
    expect(await prisma.adminAction.count()).toBe(1);
  });
});
