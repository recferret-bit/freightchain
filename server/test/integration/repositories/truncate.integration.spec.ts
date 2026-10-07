import { PrismaClient } from '@prisma/client';
import { connectedDatabase, truncateAllTables } from '../../../src/infrastructure/prisma/truncate.js';
import { testDatabaseUrl } from '../../support/harness.js';

/* The wipe guard asks the DATABASE ITSELF which database it is – an environment variable that changed after the client was built can't fool it. */
const maintenanceUrl = () => testDatabaseUrl().replace(/\/[^/?]+(\?|$)/, '/postgres$1'); // a real database NOT named *_test

describe('truncateAllTables guard (PostgreSQL)', () => {
  it('refuses a client connected to a database not named *_test – even while DATABASE_URL says *_test', async () => {
    const saved = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = testDatabaseUrl(); // the reviewer's scenario: the env points at *_test, the client does not
    const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl() } } });
    try {
      expect(await connectedDatabase(client)).toBe('postgres');
      await expect(truncateAllTables(client)).rejects.toThrow(/refusing to truncate "postgres"/);
    } finally {
      process.env['DATABASE_URL'] = saved;
      await client.$disconnect();
    }
  });

  it('wipes a *_test database', async () => {
    const client = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
    try {
      await truncateAllTables(client); // other spec files leave rows behind
      await client.player.create({ data: { wallet: 'w', version: 1, freeRides: 5, freeDay: '2036-10-08', createdAt: new Date(0) } });
      await truncateAllTables(client);
      expect(await client.player.count()).toBe(0);
    } finally {
      await client.$disconnect();
    }
  });
});
