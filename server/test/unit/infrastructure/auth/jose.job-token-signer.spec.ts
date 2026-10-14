import { Keypair } from '@solana/web3.js';
import { JoseJobTokenSigner } from '../../../../src/infrastructure/auth/jose.job-token-signer.js';
import { JoseEditorTokenSigner } from '../../../../src/infrastructure/auth/jose.editor-token-signer.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { NodeEntropy } from '../../../../src/infrastructure/crypto/node.entropy.js';
import { FakeClock } from '../../../support/fake-clock.js';

const env = (over: Record<string, unknown> = {}) => ({ jwtSecret: 'p'.repeat(40), editorJobTimeoutMs: 600_000, editorJwtSecret: 'e'.repeat(40), editorSessionTtlMinutes: 60, ...over }) as unknown as EnvService;
const wallet = Keypair.generate().publicKey.toBase58(), jobId = '00000000-0000-4000-8000-000000000001';

describe('JoseJobTokenSigner', () => {
  it('a job token carries the job, the wallet and the entity, and lives for the job timeout + 1 min', async () => {
    const clock = new FakeClock(), s = new JoseJobTokenSigner(env(), new NodeEntropy(), clock);
    const t = await s.sign({ jobId, wallet, entityId: 'cactus' });
    expect(await s.verify(t)).toEqual({ jobId, wallet, entityId: 'cactus' });
    clock.advance(600 + 59); expect(await s.verify(t)).not.toBeNull();
    clock.advance(2); expect(await s.verify(t)).toBeNull();
  });

  it('is no session token (another audience and key), and refuses junk and another JWT_SECRET', async () => {
    const clock = new FakeClock(), s = new JoseJobTokenSigner(env(), new NodeEntropy(), clock);
    expect(await s.verify((await new JoseEditorTokenSigner(env({ editorJwtSecret: 'p'.repeat(40) }), new NodeEntropy(), clock).sign(wallet)).token)).toBeNull();
    expect(await s.verify('junk')).toBeNull();
    expect(await new JoseJobTokenSigner(env({ jwtSecret: 'q'.repeat(40) }), new NodeEntropy(), clock).verify(await s.sign({ jobId, wallet, entityId: null }))).toBeNull();
    expect(await s.verify(await s.sign({ jobId: 'not-a-uuid', wallet, entityId: null }))).toBeNull();
  });
});
