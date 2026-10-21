import { MemoryConvoyRepository } from '../../../../src/infrastructure/social/memory-convoy.repository.js';

describe('MemoryConvoyRepository', () => {
  it('does not read a hidden flag while the convoyHidden column is absent', async () => {
    const repo = new MemoryConvoyRepository();
    expect(repo.privacyColumn()).toBe('missing');
    expect(await repo.writeHidden('ada', true)).toEqual({ columnPresent: false, hidden: false });
    expect(await repo.readHidden('ada')).toEqual({ columnPresent: false, hidden: false });
    repo.columnPresent = true;
    expect(await repo.writeHidden('ada', true)).toEqual({ columnPresent: true, hidden: true });
    expect(await repo.readHidden('ada')).toEqual({ columnPresent: true, hidden: true });
  });
});
