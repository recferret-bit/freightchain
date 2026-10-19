import { Keypair } from '@solana/web3.js';
import { JoseAdminTokenSigner } from '../../../../src/infrastructure/auth/jose.admin-token-signer.js';
import { JoseTokenSigner } from '../../../../src/infrastructure/auth/jose.token-signer.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { NodeEntropy } from '../../../../src/infrastructure/crypto/node.entropy.js';
import { FakeClock } from '../../../support/fake-clock.js';

const env = (over: Partial<Record<'jwtSecret' | 'adminJwtSecret', string>> & { adminSessionTtlMinutes?: number } = {}) =>
  ({ jwtSecret: 'p'.repeat(40), sessionTtlDays: 7, adminJwtSecret: 'a'.repeat(40), adminSessionTtlMinutes: 120, ...over }) as unknown as EnvService;
const wallet = Keypair.generate().publicKey.toBase58();

describe('JoseAdminTokenSigner', () => {
  it('signs an admin session for the wallet that lasts ADMIN_SESSION_TTL_MINUTES on the clock', async () => {
    const clock = new FakeClock();
    const signer = new JoseAdminTokenSigner(env({ adminSessionTtlMinutes: 30 }), new NodeEntropy(), clock);
    const { token, expiresAt } = await signer.sign(wallet);
    expect(expiresAt.getTime()).toBe(clock.ms + 30 * 60_000);
    expect(await signer.verify(token)).toBe(wallet);
    clock.advance(30 * 60 + 1);
    expect(await signer.verify(token)).toBeNull();
  });

  it('an admin token is no player session and a player session is no admin token – even with the same key', async () => {
    const clock = new FakeClock();
    const same = env({ adminJwtSecret: 'p'.repeat(40) });
    const admin = new JoseAdminTokenSigner(same, new NodeEntropy(), clock), player = new JoseTokenSigner(same, new NodeEntropy(), clock);
    expect(await admin.verify((await player.sign(wallet)).token)).toBeNull();
    expect(await player.verify((await admin.sign(wallet)).token)).toBeNull();
  });

  it('refuses another admin key (rotating ADMIN_JWT_SECRET signs every admin out), a tampered token, junk, a non-wallet subject', async () => {
    const clock = new FakeClock();
    const signer = new JoseAdminTokenSigner(env(), new NodeEntropy(), clock);
    const { token } = await signer.sign(wallet);
    expect(await new JoseAdminTokenSigner(env({ adminJwtSecret: 'b'.repeat(40) }), new NodeEntropy(), clock).verify(token)).toBeNull();
    expect(await signer.verify(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(await signer.verify('garbage')).toBeNull();
    expect(await signer.verify((await signer.sign('not-a-wallet')).token)).toBeNull();
  });
});
