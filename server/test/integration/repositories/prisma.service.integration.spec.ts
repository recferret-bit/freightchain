import { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { testPrisma } from '../../support/db.js';

describe('PrismaService (PostgreSQL)', () => {
  it('connects on module init and disconnects on destroy', async () => {
    const prisma = await testPrisma();
    expect(await prisma.player.count()).toBeGreaterThanOrEqual(0);
    await prisma.onModuleDestroy();
  });

  it('starts even when the database is unreachable (readiness reports it instead of crashing the boot)', async () => {
    const prisma = new PrismaService({ datasources: { db: { url: 'postgresql://nobody:nothing@127.0.0.1:1/none_test' } } }); // Prisma reads the URL when it connects
    await expect(prisma.onModuleInit()).resolves.toBeUndefined();
  });
});
