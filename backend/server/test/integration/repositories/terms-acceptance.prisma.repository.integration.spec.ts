import { TermsAcceptancePrismaRepository } from '../../../src/infrastructure/prisma/repositories/terms-acceptance.prisma.repository.js';
import { PlayerPrismaRepository } from '../../../src/infrastructure/prisma/repositories/player.prisma.repository.js';
import { AcceptTermsHandler } from '../../../src/application/use-cases/players/terms/accept-terms.handler.js';
import { AcceptTermsCommand } from '../../../src/application/use-cases/players/terms/accept-terms.command.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { FakeClock } from '../../support/fake-clock.js';
import { T0, inTx, testPrisma, wipe, seedPlayer } from '../../support/db.js';
describe('Terms acceptance (PostgreSQL)', () => {
  let prisma: PrismaService, repo: TermsAcceptancePrismaRepository;
  beforeAll(async () => { prisma = await testPrisma(); repo = new TermsAcceptancePrismaRepository(prisma); });
  afterAll(() => prisma.$disconnect()); beforeEach(() => wipe(prisma));
  const row = { wallet: 'w', termsVersion: 1, privacyVersion: 1, acceptedAt: T0, age18: true };
  it('is idempotent and append-only; failed transactions leave no record', async () => {
    await expect(inTx(prisma, async tx => { await repo.insert(row, tx); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await prisma.termsAcceptance.count()).toBe(0);
    await inTx(prisma, tx => repo.insert(row, tx));
    await inTx(prisma, tx => repo.insert({ ...row, acceptedAt: new Date(T0.getTime() + 1000) }, tx));
    expect(await prisma.termsAcceptance.findMany()).toEqual([row]);
    await expect(prisma.termsAcceptance.updateMany({ data: { age18: false } })).rejects.toThrow('append-only');
    await expect(prisma.termsAcceptance.deleteMany()).rejects.toThrow('append-only');
  });
  it('serializes concurrent explicit accepts under the player lock and retains evidence after player deletion', async () => {
    await seedPlayer(prisma, 'w');
    const players = new PlayerPrismaRepository(prisma);
    const handler = new AcceptTermsHandler(players, repo, { run: fn => inTx(prisma, fn) }, new FakeClock());
    const results = await Promise.all(Array.from({ length: 8 }, () => handler.execute(new AcceptTermsCommand('w', 1, 1))));
    expect(results.every(r => !r.required)).toBe(true);
    expect(await prisma.termsAcceptance.count()).toBe(1);
    expect((await players.findByWallet('w'))?.version).toBe(2);
    await prisma.player.delete({ where: { wallet: 'w' } });
    expect(await prisma.termsAcceptance.count()).toBe(1);
  });
});
