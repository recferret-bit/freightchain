import { MemoryAirdropRepository } from '../../../../src/infrastructure/social/memory-airdrop.repository.js';

describe('MemoryAirdropRepository', () => {
  it('keeps a social id on the first wallet', async () => {
    const repo = new MemoryAirdropRepository();
    expect(await repo.claimTelegram('ada', '100')).toBe('ok');
    expect(await repo.claimTelegram('bob', '100')).toBe('taken');
    expect(await repo.claimTelegram('ada', '200')).toBe('changed');
    expect(await repo.claimX('ada', 'x1')).toBe('ok');
    expect(await repo.claimX('bob', 'x1')).toBe('taken');
  });
});
