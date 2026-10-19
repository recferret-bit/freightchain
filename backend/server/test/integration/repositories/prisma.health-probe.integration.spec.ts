import { PrismaHealthProbe } from '../../../src/infrastructure/health/prisma.health-probe.js';
import { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { testPrisma } from '../../support/db.js';

describe('PrismaHealthProbe (PostgreSQL)', () => {
  it('pings the database and reports the round trip in ms', async () => {
    const prisma = await testPrisma();
    const ms = await new PrismaHealthProbe(prisma).pingDatabase();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(ms)).toBe(true);
    await prisma.$disconnect();
  });

  it('rejects when the database is unreachable', async () => {
    const prisma = new PrismaService({ datasources: { db: { url: 'postgresql://nobody:nothing@127.0.0.1:1/none_test' } } }); // Prisma reads the URL when it connects
    await expect(new PrismaHealthProbe(prisma).pingDatabase()).rejects.toThrow();
  });
});
