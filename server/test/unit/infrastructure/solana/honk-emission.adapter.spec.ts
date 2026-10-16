import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { HonkEmissionAdapter } from '../../../../src/infrastructure/solana/honk-emission.adapter.js';

describe('HonkEmissionAdapter', () => {
  const secret = bs58.encode(Keypair.generate().secretKey);

  it('is disabled unless both HONK_EMITTER_SECRET and HONK_PROGRAM_ID are configured', async () => {
    const off = new HonkEmissionAdapter({ honkEmitterSecret: undefined, honkProgramId: undefined, solanaRpc: 'http://localhost:8899', solanaRpcFallbacks: [] } as unknown as EnvService);
    expect(off.enabled()).toBe(false);
    await expect(off.mint('00000000-0000-4000-8000-000000000001', 'w', 100n)).resolves.toBeUndefined();

    const on = new HonkEmissionAdapter({
      honkEmitterSecret: secret,
      honkProgramId: Keypair.generate().publicKey.toBase58(),
      solanaRpc: 'http://localhost:8899',
      solanaRpcFallbacks: [],
    } as unknown as EnvService);
    expect(on.enabled()).toBe(true);
    await expect(on.mint('not-a-uuid', 'w', 100n)).resolves.toBeUndefined();
    await expect(on.mint('00000000-0000-4000-8000-000000000001', 'w', 0n)).resolves.toBeUndefined();
  });
});
