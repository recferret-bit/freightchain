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
    expect(await repo.unlock({ wallet: 'a', slot: 'cabin', item: 'midnight', code: 'ONE', at: at(1) })).toBe(true);
    expect(await repo.unlock({ wallet: 'a', slot: 'cabin', item: 'midnight', code: 'TWO', at: at(2) })).toBe(false);
    expect(await repo.unlock({ wallet: 'b', slot: 'cabin', item: 'midnight', code: 'ONE', at: at(3) })).toBe(true); // another wallet may own it too
    expect(await repo.listUnlocked('a')).toEqual([{ wallet: 'a', slot: 'cabin', item: 'midnight', code: 'ONE', at: at(1) }]);
  });

  it('has and listUnlocked: this wallet only, oldest first', async () => {
    await repo.unlock({ wallet: 'a', slot: 'cabin', item: 'forest', code: 'X', at: at(5) });
    await repo.unlock({ wallet: 'a', slot: 'cabin', item: 'noir', code: 'Y', at: at(2) });
    await repo.unlock({ wallet: 'b', slot: 'cabin', item: 'sunset', code: 'Z', at: at(1) });
    expect(await repo.has('a', 'cabin', 'noir')).toBe(true);
    expect(await repo.has('a', 'cabin', 'sunset')).toBe(false);
    expect((await repo.listUnlocked('a')).map((u) => `${u.slot}:${u.item}`)).toEqual(['cabin:noir', 'cabin:forest']);
    expect(await repo.listUnlocked('nobody')).toEqual([]);
  });

  it('equip replaces what was worn in the slot; listEquipped is per wallet and ignores rows the catalog no longer has', async () => {
    expect(await repo.listEquipped('a')).toEqual({});
    await repo.equip('a', 'cabin', 'midnight');
    await repo.equip('a', 'cabin', 'noir');
    await repo.equip('b', 'cabin', 'forest');
    expect(await repo.listEquipped('a')).toEqual({ cabin: 'noir' });
    await prisma.cosmeticEquip.create({ data: { wallet: 'a', slot: 'wheel', item: 'gold' } }); // a row from an earlier catalog (per-part slots)
    expect(await repo.listEquipped('a')).toEqual({ cabin: 'noir' });
    await repo.equip('b', 'cabin', 'gone');
    expect(await repo.listEquipped('b')).toEqual({});
  });

  it('a player delete takes its cosmetics along (ON DELETE CASCADE)', async () => {
    await repo.unlock({ wallet: 'a', slot: 'cabin', item: 'midnight', code: 'ONE', at: at(1) });
    await repo.equip('a', 'cabin', 'midnight');
    await prisma.player.delete({ where: { wallet: 'a' } });
    expect(await prisma.cosmeticUnlock.count()).toBe(0);
    expect(await prisma.cosmeticEquip.count()).toBe(0);
  });
});
