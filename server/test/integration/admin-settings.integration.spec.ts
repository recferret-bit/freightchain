import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { bindClient, newWallet, sign, type Rider } from '../support/client.js';
import { createHarness, type Harness } from '../support/harness.js';

/* The signed admin settings API against PostgreSQL. The HTTP scenarios cover the answers; this file covers the race
   an in-memory store cannot: one signed change posted N times at once lands once. */
const ADMIN = newWallet();
const PARALLEL = 8;

describe('admin settings API (PostgreSQL)', () => {
  let harness: Harness;
  let prisma: PrismaService;
  const { login, loginAdmin } = bindClient(() => harness);

  beforeAll(async () => {
    harness = await createHarness('postgres', { FREE_RIDE_SECONDS: '10', ADMIN_WALLETS: ADMIN.address });
    prisma = harness.app.get(PrismaService, { strict: false });
  });
  afterAll(() => harness.close());
  beforeEach(() => harness.reset());

  const parallel = <T>(fn: () => Promise<T>): Promise<T[]> => Promise.all(Array.from({ length: PARALLEL }, () => fn()));
  const freeRides = async (rider: Rider) => (await rider.agent.get('/api/me').expect(200)).body.freeRides as number;

  it('N posts of one signed free-ride adjust apply it once, and the rest are 401', async () => {
    const rider = await login(), admin = await loginAdmin(ADMIN);
    const { body } = await admin.agent.post('/api/admin/players/free-rides/challenge').set('x-fc-admin', '1').send({ action: 'free_rides_adjust', wallet: rider.address, delta: 3 }).expect(200);
    const signature = sign(admin.kp, body.message as string);
    const results = await parallel(() => admin.agent.post('/api/admin/players/free-rides').set('x-fc-admin', '1').send({ wallet: rider.address, delta: 3, signature }));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(PARALLEL - 1);
    expect(await freeRides(rider)).toBe(13); // 10 at signup + 3, once
    expect(await prisma.adminAction.count({ where: { action: 'free_rides.adjust', target: rider.address } })).toBe(1);
  });

  it('N posts of one signed setting update write the row once', async () => {
    const admin = await loginAdmin(ADMIN);
    const { body } = await admin.agent.post('/api/admin/settings/challenge').set('x-fc-admin', '1').send({ action: 'setting_update', key: 'free_on_signup', value: 7 }).expect(200);
    const signature = sign(admin.kp, body.message as string);
    const results = await parallel(() => admin.agent.post('/api/admin/settings').set('x-fc-admin', '1').send({ key: 'free_on_signup', value: 7, signature }));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(PARALLEL - 1);
    expect((await admin.agent.get('/api/admin/settings').expect(200)).body.freeOnSignup).toBe(7);
    expect(await prisma.adminAction.count({ where: { action: 'setting.update', target: 'free_on_signup' } })).toBe(1);
    expect(await prisma.gameSetting.findUnique({ where: { key: 'free_on_signup' } })).toMatchObject({ value: 7 });
    expect(await freeRides(await login())).toBe(7); // a wallet created after the write starts at the new number
  });
});
