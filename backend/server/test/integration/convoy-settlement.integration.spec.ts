import { ReleaseConvoyHandler } from '../../src/application/referral/release-convoy.handler.js';
import { ReleaseConvoyCommand } from '../../src/application/referral/release-convoy.command.js';
import type { ReferralEmissionPort, ReferralPayment, ReferralSettlement } from '../../src/application/ports/honk/referral-emission.port.js';
import { ConvoyPrismaRepository } from '../../src/infrastructure/prisma/repositories/convoy.prisma.repository.js';
import { PlayerPrismaRepository } from '../../src/infrastructure/prisma/repositories/player.prisma.repository.js';
import { HonkPrismaRepository } from '../../src/infrastructure/prisma/repositories/honk.prisma.repository.js';
import { TransactionPrismaAdapter } from '../../src/infrastructure/prisma/transaction.prisma.adapter.js';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { FakeClock } from '../support/fake-clock.js';
import { SequenceEntropy } from '../support/unit-context.js';
import { inTx, seedPlayer, testPrisma, wipe } from '../support/db.js';

const command = new ReleaseConvoyCommand();
describe('Convoy settlement PostgreSQL concurrency and recovery', () => {
  let db: PrismaService, other: PrismaService, repo: ConvoyPrismaRepository, clock: FakeClock;
  const entropy = new SequenceEntropy();
  beforeAll(async () => { db = await testPrisma(); other = await testPrisma(); repo = new ConvoyPrismaRepository(db); });
  afterAll(async () => { await other.$disconnect(); await db.$disconnect(); });
  beforeEach(async () => {
    await wipe(db); await seedPlayer(db, 'a'); await seedPlayer(db, 'b'); clock = new FakeClock();
    await repo.insertLedger({ id: 'convoy:m1:b', kind: 'm1', wallet: 'a', referrer: 'a', referee: 'b', amount: 100, unit: 'ten4', at: clock.now(), dayKey: 'd', weekKey: 'w', chainState: 'held', releasedAt: null });
    clock.advance(48 * 3600);
  });
  const worker = (prisma: PrismaService, emission: ReferralEmissionPort) => new ReleaseConvoyHandler(new ConvoyPrismaRepository(prisma), new PlayerPrismaRepository(prisma), new TransactionPrismaAdapter(prisma), emission, new HonkPrismaRepository(prisma), clock, entropy);

  it('two workers on separate connections submit and credit exactly once under the player lock', async () => {
    const settle = vi.fn(async (p: ReferralPayment): Promise<ReferralSettlement> => {
      await p.onSubmitted({ signature: 'landed', lastValidBlockHeight: 100 });
      expect(await new ConvoyPrismaRepository(other).findLedger(p.rewardId)).toMatchObject({ chainSignature: 'landed' });
      return { kind: 'paid', amount: 50_000_000n };
    });
    const emission = { enabled: () => true, settle };
    const results = await Promise.all([worker(db, emission).execute(command), worker(other, emission).execute(command)]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(settle).toHaveBeenCalledOnce();
    expect(await new HonkPrismaRepository(other).balance('a')).toBe(50_000_000n);
    expect(await repo.findLedger('convoy:m1:b')).toMatchObject({ chainState: 'paid', paidUnits: 50_000_000n, chainLeaseId: null });
  });

  it('a restart recovers a persisted ambiguous submission without losing the payment identity', async () => {
    const first: ReferralEmissionPort = { enabled: () => true, settle: async (p) => { await p.onSubmitted({ signature: 'ambiguous', lastValidBlockHeight: 123 }); throw new Error('response lost'); } };
    expect(await worker(db, first).execute(command)).toBe(0);
    expect(await new HonkPrismaRepository(other).balance('a')).toBe(0n);
    clock.advance(121);
    const recovered: ReferralEmissionPort = { enabled: () => true, settle: async (p) => { expect(p.submitted).toEqual({ signature: 'ambiguous', lastValidBlockHeight: 123 }); return { kind: 'paid', amount: 100_000_000n }; } };
    expect(await worker(other, recovered).execute(command)).toBe(1);
    expect(await worker(db, recovered).execute(command)).toBe(0);
    expect(await new HonkPrismaRepository(db).balance('a')).toBe(100_000_000n);
  });

  it('settlement and spendable credit roll back together, and a stale lease cannot replace the owner', async () => {
    const row = (await repo.findLedger('convoy:m1:b'))!;
    await inTx(db, async (tx) => {
      await new PlayerPrismaRepository(db).findByWalletForUpdate('a', tx);
      expect(await repo.saveSettlement({ ...row, chainLeaseId: 'owner' }, null, tx)).toBe(true);
      expect(await repo.saveSettlement({ ...row, chainLeaseId: 'intruder' }, null, tx)).toBe(false);
    });
    await expect(inTx(db, async (tx) => {
      await new PlayerPrismaRepository(db).findByWalletForUpdate('a', tx);
      expect(await repo.saveSettlement({ ...row, chainState: 'paid', paidUnits: 100_000_000n }, 'owner', tx)).toBe(true);
      await new HonkPrismaRepository(db).credit('a', 100_000_000n, clock.now(), tx);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await new ConvoyPrismaRepository(other).findLedger(row.id)).toMatchObject({ chainState: 'held', paidUnits: 0n, chainLeaseId: 'owner' });
    expect(await new HonkPrismaRepository(other).balance('a')).toBe(0n);
  });

  it('holds an earned milestone at its saved trust requirement after referrer trust drops and reconciles it once trust recovers', async () => {
    await db.convoyLedger.update({ where: { id: 'convoy:m1:b' }, data: { minTrust: 75 } });
    await db.player.update({ where: { wallet: 'a' }, data: { trustScore: 74 } });
    const settle = vi.fn(async (): Promise<ReferralSettlement> => ({ kind: 'paid', amount: 123n }));
    const emission = { enabled: () => true, settle };
    expect(await worker(db, emission).execute(command)).toBe(0);
    expect(settle).not.toHaveBeenCalled();
    expect((await repo.findLedger('convoy:m1:b'))?.chainState).toBe('held');
    await db.player.update({ where: { wallet: 'a' }, data: { trustScore: 75 } });
    clock.advance(121);
    expect(await worker(db, emission).execute(command)).toBe(1);
    expect(await worker(db, emission).execute(command)).toBe(0);
    expect(await new HonkPrismaRepository(db).balance('a')).toBe(123n);
    expect(settle).toHaveBeenCalledOnce();
  });

  it('due queries exclude legacy, capped, young and leased rows; trust failures do not starve later work', async () => {
    const row = (await repo.findLedger('convoy:m1:b'))!;
    for (const [id, over] of Object.entries({ legacy: { chainState: 'legacy' as const }, capped: { chainState: 'capped' as const }, young: { at: clock.now() }, leased: { chainRetryAt: new Date(clock.now().getTime() + 1) } })) await repo.insertLedger({ ...row, id, ...over });
    expect((await repo.pendingSettlements(clock.now(), new Date(clock.now().getTime() - 48 * 3600_000), 50)).map((r) => r.id)).toEqual([row.id]);
    await db.player.update({ where: { wallet: 'b' }, data: { trustScore: 49 } });
    const settle = vi.fn(async (): Promise<ReferralSettlement> => ({ kind: 'paid', amount: 1n }));
    expect(await worker(db, { enabled: () => true, settle }).execute(command)).toBe(0);
    expect(settle).not.toHaveBeenCalled();
    expect((await repo.findLedger(row.id))?.chainRetryAt).toEqual(new Date(clock.now().getTime() + 120_000));
  });
});
