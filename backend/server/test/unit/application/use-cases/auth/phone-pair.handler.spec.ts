import { MemoryCacheAdapter } from '../../../../../src/infrastructure/cache/memory-cache.adapter.js';
import { ClaimPhonePairHandler, OpenPhonePairHandler, PollPhonePairHandler } from '../../../../../src/application/use-cases/auth/phone-pair/phone-pair.handler.js';
import { ClaimPhonePairCommand, OpenPhonePairCommand, PollPhonePairCommand } from '../../../../../src/application/use-cases/auth/phone-pair/phone-pair.command.js';
import { TokenSignerPort } from '../../../../../src/application/ports/auth/token-signer.port.js';
import { EntropyPort } from '../../../../../src/application/ports/shared/entropy.port.js';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { FakeClock } from '../../../../support/fake-clock.js';

class SeqEntropy extends EntropyPort {
  n = 0;
  uuid(): string { return String(this.n); }
  hex(): string { return (this.n++ % 2 === 0 ? 'a' : 'b').repeat(32); }
  seed31(): number { return 1; }
  referenceKey(): string { return 'x'; }
}

class StubTokens extends TokenSignerPort {
  async sign(): Promise<{ token: string; expiresAt: Date }> { return { token: 't', expiresAt: new Date(0) }; }
  async verify(token: string): Promise<string | null> { return token === 'good' ? 'Wallet1111111111111111111111111111111111111' : null; }
}

describe('phone sign-in pair', () => {
  const clock = new FakeClock();
  const cache = new MemoryCacheAdapter(clock);
  const entropy = new SeqEntropy();
  const open = new OpenPhonePairHandler(cache, clock, entropy);
  const claim = new ClaimPhonePairHandler(cache, new StubTokens());
  const poll = new PollPhonePairHandler(cache);

  it('the phone session moves to the computer that holds the secret, once', async () => {
    const created = await open.execute(new OpenPhonePairCommand());
    expect(created.id).toHaveLength(32);
    expect(created.secret).not.toBe(created.id);
    expect(await poll.execute(new PollPhonePairCommand(created.id, created.secret))).toEqual({ status: 'pending' });
    await expect(poll.execute(new PollPhonePairCommand(created.id, 'nope'))).rejects.toBeInstanceOf(NotFoundError);
    await expect(claim.execute(new ClaimPhonePairCommand(created.id, null))).rejects.toBeInstanceOf(UnauthorizedError);
    await claim.execute(new ClaimPhonePairCommand(created.id, 'good'));
    await expect(claim.execute(new ClaimPhonePairCommand(created.id, 'good'))).rejects.toBeInstanceOf(ConflictError);
    const ready = await poll.execute(new PollPhonePairCommand(created.id, created.secret));
    expect(ready).toMatchObject({ status: 'ready', wallet: 'Wallet1111111111111111111111111111111111111', token: 'good' });
    await expect(poll.execute(new PollPhonePairCommand(created.id, created.secret))).rejects.toBeInstanceOf(NotFoundError);
  });
});
