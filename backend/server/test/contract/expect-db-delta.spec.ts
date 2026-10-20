import { expectDbDelta } from '../helpers/expect-db-delta.js';

const fake = (seed: Record<string, number>) => {
  const rows = { ...seed };
  const prisma: Record<string, { count: () => Promise<number> }> = {};
  for (const model of Object.keys(rows)) prisma[model.charAt(0).toLowerCase() + model.slice(1)] = { count: async () => rows[model] ?? 0 };
  return { prisma, rows };
};

describe('expectDbDelta', () => {
  it('requires an exact +1', async () => {
    const { prisma, rows } = fake({ Ride: 2 });
    await expectDbDelta(prisma, { Ride: 1 }, async () => { rows.Ride += 1; return { status: 200 }; });
    expect(rows.Ride).toBe(3);
  });

  it('a 4xx path must write nothing to the named tables', async () => {
    const { prisma, rows } = fake({ Ride: 4, TicketOrder: 1 });
    const response = await expectDbDelta(prisma, { Ride: 0, TicketOrder: 0 }, async () => ({ status: 404 }));
    expect(response.status).toBe(404);
    await expect(expectDbDelta(prisma, { Ride: 0 }, async () => { rows.Ride += 1; return { status: 400 }; })).rejects.toThrow(/Ride changed by 1 on HTTP 400/);
    expect(rows.Ride).toBe(5);
  });

  it('a thrown 4xx with a write fails, and a clean throw is rethrown', async () => {
    const { prisma, rows } = fake({ Pledge: 0 });
    const clean = Object.assign(new Error('pledge not found'), { statusCode: 404 });
    await expect(expectDbDelta(prisma, { Pledge: 0 }, async () => { throw clean; })).rejects.toBe(clean);
    await expect(expectDbDelta(prisma, { Pledge: 0 }, async () => { rows.Pledge += 1; throw Object.assign(new Error('no'), { statusCode: 409 }); })).rejects.toThrow(/Pledge changed by 1/);
  });
});
