import { Keypair } from '@solana/web3.js';
import { JoseAdminTokenSigner } from '../../../../src/infrastructure/auth/jose.admin-token-signer.js';
import { JoseEditorTokenSigner } from '../../../../src/infrastructure/auth/jose.editor-token-signer.js';
import { JoseTokenSigner } from '../../../../src/infrastructure/auth/jose.token-signer.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { NodeEntropy } from '../../../../src/infrastructure/crypto/node.entropy.js';
import { FakeClock } from '../../../support/fake-clock.js';

const env = (over: Record<string, unknown> = {}) =>
  ({ jwtSecret: 'p'.repeat(40), sessionTtlDays: 7, adminJwtSecret: 'a'.repeat(40), adminSessionTtlMinutes: 120, editorJwtSecret: 'e'.repeat(40), editorSessionTtlMinutes: 240, ...over }) as unknown as EnvService;
const wallet = Keypair.generate().publicKey.toBase58();

describe('JoseEditorTokenSigner', () => {
  it('an editor session lasts EDITOR_SESSION_TTL_MINUTES on the clock', async () => {
    const clock = new FakeClock(), signer = new JoseEditorTokenSigner(env({ editorSessionTtlMinutes: 30 }), new NodeEntropy(), clock);
    const { token, expiresAt } = await signer.sign(wallet);
    expect(expiresAt.getTime()).toBe(clock.ms + 30 * 60_000);
    expect(await signer.verify(token)).toBe(wallet);
    clock.advance(30 * 60 + 1);
    expect(await signer.verify(token)).toBeNull();
  });

  it('is neither a player nor an admin session, even with the same key; another editor key refuses it', async () => {
    const clock = new FakeClock(), same = env({ editorJwtSecret: 'p'.repeat(40), adminJwtSecret: 'p'.repeat(40) });
    const editor = new JoseEditorTokenSigner(same, new NodeEntropy(), clock);
    const token = (await editor.sign(wallet)).token;
    expect(await new JoseTokenSigner(same, new NodeEntropy(), clock).verify(token)).toBeNull();
    expect(await new JoseAdminTokenSigner(same, new NodeEntropy(), clock).verify(token)).toBeNull();
    expect(await editor.verify((await new JoseAdminTokenSigner(same, new NodeEntropy(), clock).sign(wallet)).token)).toBeNull();
    expect(await new JoseEditorTokenSigner(env({ editorJwtSecret: 'x'.repeat(40) }), new NodeEntropy(), clock).verify(token)).toBeNull();
  });
});
