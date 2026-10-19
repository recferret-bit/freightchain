import { JoseTokenSigner } from '../../../../src/infrastructure/auth/jose.token-signer.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { NodeEntropy } from '../../../../src/infrastructure/crypto/node.entropy.js';
import { Keypair } from '@solana/web3.js';
import { FakeClock } from '../../../support/fake-clock.js';

const env = (jwtSecret: string, sessionTtlDays = 7) => ({ jwtSecret, sessionTtlDays }) as unknown as EnvService;
const wallet = Keypair.generate().publicKey.toBase58();

describe('JoseTokenSigner', () => {
  it('signs a session whose subject is the wallet; issue / expiry come from the clock', async () => {
    const clock = new FakeClock();
    const signer = new JoseTokenSigner(env('s'.repeat(40)), new NodeEntropy(), clock);
    const { token, expiresAt } = await signer.sign(wallet);
    expect(expiresAt.getTime()).toBe(clock.ms + 7 * 86_400_000);
    expect(await signer.verify(token)).toBe(wallet);
  });

  it('a session expires on the CLOCK, not on the wall time', async () => {
    const clock = new FakeClock();
    const signer = new JoseTokenSigner(env('s'.repeat(40), 1), new NodeEntropy(), clock);
    const { token } = await signer.sign(wallet);
    clock.advance(86_399);
    expect(await signer.verify(token)).toBe(wallet);
    clock.advance(2);
    expect(await signer.verify(token)).toBeNull();
  });

  it('refuses another secret, a tampered token, junk, and a subject that is not a wallet', async () => {
    const clock = new FakeClock();
    const signer = new JoseTokenSigner(env('s'.repeat(40)), new NodeEntropy(), clock);
    const { token } = await signer.sign(wallet);
    expect(await new JoseTokenSigner(env('t'.repeat(40)), new NodeEntropy(), clock).verify(token)).toBeNull();
    expect(await signer.verify(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(await signer.verify('garbage')).toBeNull();
    expect(await signer.verify((await signer.sign('not-a-wallet')).token)).toBeNull();
  });
});
