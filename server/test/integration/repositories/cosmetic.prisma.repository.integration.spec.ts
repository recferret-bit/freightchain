import { CosmeticPrismaRepository } from '../../../src/infrastructure/prisma/repositories/cosmetic.prisma.repository.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { at, seedPlayer, testPrisma, wipe } from '../../support/db.js';

describe('CosmeticPrismaRepository (PostgreSQL)', () => {
  let prisma: PrismaService, repo: CosmeticPrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new CosmeticPrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await wipe(prisma);
    for (const w of ['a', 'b']) await seedPlayer(prisma, w);
  });

  it('unlock once per (wallet, slot, item): the second try is false and changes nothing', async () => {
    expect(await repo.unlock({ wallet: 'a', slot: 'wheel', item: 'crimson', code: 'ONE', at: at(1) })).toBe(true);
    expect(await repo.unlock({ wallet: 'a', slot: 'wheel', item: 'crimson', code: 'TWO', at: at(2) })).toBe(false);
    expect(await repo.unlock({ wallet: 'b', slot: 'wheel', item: 'crimson', code: 'ONE', at: at(3) })).toBe(true); // another wallet may own it too
    expect(await repo.unlock({ wallet: 'a', slot: 'gearbox', item: 'gold', code: 'THREE', at: at(4) })).toBe(true); // the same name in another slot is another item
    expect(await repo.listUnlocked('a')).toEqual([
      { wallet: 'a', slot: 'wheel', item: 'crimson', code: 'ONE', at: at(1) }, { wallet: 'a', slot: 'gearbox', item: 'gold', code: 'THREE', at: at(4) },
    ]);
  });

  it('has and listUnlocked: this wallet only, oldest first', async () => {
    await repo.unlock({ wallet: 'a', slot: 'gearbox', item: 'chrome', code: 'X', at: at(5) });
    await repo.unlock({ wallet: 'a', slot: 'wheel', item: 'gold', code: 'Y', at: at(2) });
    await repo.unlock({ wallet: 'b', slot: 'wheel', item: 'ocean', code: 'Z', at: at(1) });
    expect(await repo.has('a', 'wheel', 'gold')).toBe(true);
    expect(await repo.has('a', 'wheel', 'ocean')).toBe(false);
    expect((await repo.listUnlocked('a')).map((u) => `${u.slot}:${u.item}`)).toEqual(['wheel:gold', 'gearbox:chrome']);
    expect(await repo.listUnlocked('nobody')).toEqual([]);
  });

  it('equip replaces what was worn in the slot; listEquipped is per wallet and ignores rows the catalog no longer has', async () => {
    expect(await repo.listEquipped('a')).toEqual({});
    await repo.equip('a', 'wheel', 'crimson');
    await repo.equip('a', 'wheel', 'gold');
    await repo.equip('a', 'truck_color', 'blue');
    await repo.equip('b', 'wheel', 'moss');
    expect(await repo.listEquipped('a')).toEqual({ wheel: 'gold', truck_color: 'blue' });
    await prisma.cosmeticEquip.create({ data: { wallet: 'a', slot: 'seat', item: 'x' } }); // a slot the catalog does not have
    await prisma.cosmeticEquip.create({ data: { wallet: 'a', slot: 'gearbox', item: 'gone' } });
    expect(await repo.listEquipped('a')).toEqual({ wheel: 'gold', truck_color: 'blue' });
  });

  it('a player delete takes its cosmetics along (ON DELETE CASCADE)', async () => {
    await repo.unlock({ wallet: 'a', slot: 'wheel', item: 'crimson', code: 'ONE', at: at(1) });
    await repo.equip('a', 'wheel', 'crimson');
    await prisma.player.delete({ where: { wallet: 'a' } });
    expect(await prisma.cosmeticUnlock.count()).toBe(0);
    expect(await prisma.cosmeticEquip.count()).toBe(0);
  });
});
