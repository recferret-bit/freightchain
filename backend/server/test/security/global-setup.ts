import setupDatabase from '../integration/global-setup.js';

/** Vitest's test.env is applied in workers, after global setup. Select the security database before migrating. */
export default async function setup(): Promise<void> {
  const url = 'postgresql://freight:freight_dev_password@127.0.0.1:15433/freightchain_agent1_test';
  if (process.env['TEST_DATABASE_URL'] && process.env['TEST_DATABASE_URL'] !== url) throw new Error('security tests require their isolated freightchain_agent1_test database');
  process.env['TEST_DATABASE_URL'] = url;
  await setupDatabase();
}
