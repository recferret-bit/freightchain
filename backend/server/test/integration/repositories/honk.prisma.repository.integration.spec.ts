import { ReleaseHonkHandler } from '../../../src/application/use-cases/honk/release-honk.handler.js';
import { ReleaseHonkCommand } from '../../../src/application/use-cases/honk/release-honk.command.js';
import { PlayerPrismaRepository } from '../../../src/infrastructure/prisma/repositories/player.prisma.repository.js';
import { TransactionPrismaAdapter } from '../../../src/infrastructure/prisma/transaction.prisma.adapter.js';
import { HonkMintService } from '../../../src/application/services/honk-mint.service.js';
import { HonkPrismaRepository } from '../../../src/infrastructure/prisma/repositories/honk.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { HONK_PARTS } from '../../../src/domain/honk/parts-catalog.js';
import { HONK_EMISSION_CAP } from '../../../src/domain/honk/tokenomics.js';
import type { ClockPort } from '../../../src/application/ports/shared/clock.port.js';
import { at, inTx, seedPlayer, testPrisma, wipe } from '../../support/db.js';

const U = 1_000_000n;
const ride = (rideId: string, distance = 10_000) => ({ rideId, wallet: 'w', tier: '1h', distance, completeDist: 10_000 });

describe('HonkPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: HonkPrismaRepository, mint: HonkMintService;
  const clock = { ms: at(3).getTime(), now() { return new Date(this.ms); } };
  beforeAll(async () => {
    prisma = await testPrisma();
    repo = new HonkPrismaRepository(prisma);
    mint = new HonkMintService(repo, clock as ClockPort);
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => { clock.ms = at(3).getTime(); return wipe(prisma); });

  it('credits a wallet, debits only what the balance covers, and a reversed burn puts it back', async () => {
    await repo.credit('w', 50n * U, at(1));
    expect(await repo.balance('w')).toBe(50n * U);
    expect(await repo.debit('w', 60n * U, at(2))).toBe(false);
    expect(await repo.debit('w', 20n * U, at(2))).toBe(true);
    await repo.insertBurn({ id: 'b1', wallet: 'w', amount: 20n * U, kind: 'stream', ref: 'ride', createdAt: at(2) });
    expect(await repo.account('w')).toMatchObject({ balance: 30n * U, minted: 50n * U, burned: 20n * U });
    expect((await repo.lastStreamBurn('w', 'ride'))?.getTime()).toBe(at(2).getTime());
    await repo.reverseBurn('b1');
    expect(await repo.account('w')).toMatchObject({ balance: 50n * U, burned: 0n });
    expect(await prisma.honkBurn.count()).toBe(0);
  });

  it('one visual per wallet, slot and item', async () => {
    const row = { id: 'v1', wallet: 'w', slot: 'wheel', item: 'gold', amount: 200n * U, createdAt: at(1) };
    expect(await repo.insertVisual(row)).toBe(true);
    expect(await repo.insertVisual({ ...row, id: 'v2' })).toBe(false);
    expect(await repo.visuals('w')).toHaveLength(1);
    await repo.setVisualChain('v1', 'MintAddress111', 'sig');
    expect(await repo.visuals('w')).toMatchObject([{ chainMint: 'MintAddress111', chainSignature: 'sig' }]);
    await repo.deleteVisual('v1');
    expect(await repo.visuals('w')).toHaveLength(0);
  });

  it('two concurrent mints of one ride produce one row and one credit', async () => {
    const [a, b] = await Promise.all([
      inTx(prisma, (tx) => mint.credit(ride('same'), tx)),
      inTx(prisma, (tx) => mint.credit(ride('same'), tx)),
    ]);
    expect([a, b]).toContain(100n * U);
    expect([a, b]).toContain(null);
    expect(await prisma.honkMint.count()).toBe(1);
    expect(await repo.balance('w')).toBe(100n * U);
    expect((await prisma.honkSupply.findUnique({ where: { id: 1 } }))?.minted).toBe(100n * U);
    expect(await repo.counts('w')).toEqual({ mints: 1, finishes: 1 });
  });

  it('lists the seeded cab parts: 54 rows, gold wheel 260000000, classic wheel free', async () => {
    const parts = await repo.listParts();
    expect(parts).toHaveLength(54);
    expect(parts).toEqual([...HONK_PARTS]);
    expect(parts.find((p) => p.slot === 'wheel' && p.item === 'gold')?.price).toBe(260000000n);
    expect(parts.find((p) => p.slot === 'wheel' && p.item === 'classic')?.price).toBeNull();
    expect(await repo.findPart('needle', 'gold')).toMatchObject({ price: 260000000n, name: 'Needles · Gold' });
    expect(await repo.findPart('ornament', 'spear')).toMatchObject({ price: null, name: 'Ornament · Spear', sort: 30 });
    expect(await repo.findPart('phone', 'clear')).toMatchObject({ price: 65000000n, sort: 53 });
    expect(await repo.findPart('wheel', 'nope')).toBeNull();
  });

  it('a mint near the emission cap pays the era-scaled finish, not the raw room', async () => {
    await prisma.honkSupply.create({ data: { id: 1, minted: HONK_EMISSION_CAP - 10n * U } });
    // 10 TEN4 of cap room is era 22. A finished 1h there is 23 base units, and the band split pays 21.
    expect(await inTx(prisma, (tx) => mint.credit(ride('clip'), tx))).toBe(21n);
    expect((await prisma.honkSupply.findUnique({ where: { id: 1 } }))?.minted).toBe(HONK_EMISSION_CAP - 10n * U + 21n);
    await prisma.honkSupply.update({ where: { id: 1 }, data: { minted: HONK_EMISSION_CAP } });
    expect(await inTx(prisma, (tx) => mint.credit(ride('after'), tx))).toBeNull();
    expect((await prisma.honkSupply.findUnique({ where: { id: 1 } }))?.minted).toBe(HONK_EMISSION_CAP);
  });

  it('an 8h finish stays unreleased until 48h, then credits 1200, and cancel returns reserved room', async () => {
    await seedPlayer(prisma, 'w');
    clock.ms = at(3).getTime();
    expect(await inTx(prisma, (tx) => mint.credit({ ...ride('long'), tier: '8h' }, tx))).toBeNull();
    expect(await repo.balance('w')).toBe(0n);
    expect(await repo.findMint('long')).toMatchObject({ amount: 1200n * U, released: false });
    expect(await repo.counts('w')).toEqual({ mints: 0, finishes: 0 });
    clock.ms += 48 * 3600 * 1000;
    expect(await repo.listDue(new Date(clock.ms), 10)).toMatchObject([{ rideId: 'long', wallet: 'w', released: false }]);
    expect(await inTx(prisma, (tx) => mint.releaseIfDue('long', tx))).toBe(1200n * U);
    expect(await repo.balance('w')).toBe(1200n * U);
    expect(await repo.counts('w')).toEqual({ mints: 1, finishes: 1 });
    expect(await inTx(prisma, (tx) => mint.credit({ ...ride('cancelled'), tier: '8h' }, tx))).toBeNull();
    expect(await inTx(prisma, (tx) => mint.cancelPending('cancelled', tx))).toBe(1200n * U);
    expect(await repo.findMint('cancelled')).toBeNull();
  });
  it('persists pending emissions atomically and leases one attempt across competing workers', async () => {
    await seedPlayer(prisma, 'w');
    const emission = { enabled: () => true, mint: vi.fn(async () => {}) };
    const durable = new HonkMintService(repo, clock as ClockPort, emission);
    await expect(inTx(prisma, async (tx) => { await durable.credit(ride('rolled-back'), tx); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await repo.findMint('rolled-back')).toBeNull();
    await inTx(prisma, (tx) => durable.credit(ride('recover'), tx));
    const second = await testPrisma();
    try {
      const reopened = new HonkPrismaRepository(second);
      expect(await reopened.listChainPending(clock.now(), 50)).toMatchObject([{ rideId: 'recover', amount: 100n * U }]);
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      let entered!: () => void;
      const sending = new Promise<void>((resolve) => { entered = resolve; });
      emission.mint.mockImplementationOnce(async () => { entered(); await blocked; throw new Error('response lost'); });
      const worker = (db: PrismaService) => new ReleaseHonkHandler(new HonkPrismaRepository(db), durable, new PlayerPrismaRepository(db), new TransactionPrismaAdapter(db), emission, clock as ClockPort);
      const first = worker(prisma).execute(new ReleaseHonkCommand());
      await sending;
      try {
        await worker(second).execute(new ReleaseHonkCommand());
        expect(emission.mint).toHaveBeenCalledTimes(1);
      } finally { release(); await first; }
      expect(await reopened.findMint('recover')).toMatchObject({ chainPending: true });
      clock.ms += 121_000;
      await worker(second).execute(new ReleaseHonkCommand());
      expect(emission.mint).toHaveBeenCalledTimes(2);
      expect(await repo.findMint('recover')).toMatchObject({ chainPending: false, chainSentAt: clock.now() });
      expect(await repo.balance('w')).toBe(100n * U);
      expect(await reopened.listChainPending(clock.now(), 50)).toEqual([]);
    } finally { await second.$disconnect(); }
  });

});
