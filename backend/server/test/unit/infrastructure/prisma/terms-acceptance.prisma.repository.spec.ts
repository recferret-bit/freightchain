import { TermsAcceptancePrismaRepository } from '../../../../src/infrastructure/prisma/repositories/terms-acceptance.prisma.repository.js';
import type { TransactionHandle } from '../../../../src/application/ports/shared/transaction.port.js';
describe('TermsAcceptancePrismaRepository', () => {
  it('appends idempotently through the provided transaction rather than the global client', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { termsAcceptance: { createMany } } as unknown as TransactionHandle;
    const row = { wallet: 'w', termsVersion: 1, privacyVersion: 1, acceptedAt: new Date(0), age18: true };
    await new TermsAcceptancePrismaRepository({} as never).insert(row, tx);
    expect(createMany).toHaveBeenCalledWith({ data: [row], skipDuplicates: true });
  });
});
