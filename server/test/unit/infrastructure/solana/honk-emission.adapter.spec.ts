import { Keypair } from '@solana/web3.js';
import { HonkEmissionAdapter } from '../../../../src/infrastructure/solana/honk-emission.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const RIDE = '00000000-0000-4000-8000-000000000001';
const secret = () => JSON.stringify(Array.from(Keypair.generate().secretKey));

describe('HonkEmissionAdapter', () => {
  const env = (over: Partial<EnvService> = {}) => ({ solanaRpc: 'http://127.0.0.1:1', honkProgramId: undefined, honkEmitterSecret: undefined, ...over }) as EnvService;

  it('stays off without a program id or an emitter key, and a disabled mint does not throw', async () => {
    const off = new HonkEmissionAdapter(env());
    expect(off.enabled()).toBe(false);
    await expect(off.mint(RIDE, 'w', '1h', 0b111, 20_000)).resolves.toBeUndefined();
    expect(new HonkEmissionAdapter(env({ honkProgramId: 'GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx' })).enabled()).toBe(false);
    expect(new HonkEmissionAdapter(env({ honkEmitterSecret: secret() })).enabled()).toBe(false);
  });

  it('is on when both are set, and refuses a tier, a band mask, a day, or a ride id the program would not accept', async () => {
    const on = new HonkEmissionAdapter(env({ honkProgramId: 'GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx', honkEmitterSecret: secret() }));
    expect(on.enabled()).toBe(true);
    await expect(on.mint(RIDE, 'w', 'free', 0b111, 20_000)).resolves.toBeUndefined();
    await expect(on.mint(RIDE, 'w', '1h', 0, 20_000)).resolves.toBeUndefined();
    await expect(on.mint(RIDE, 'w', '1h', 0b111, -1)).resolves.toBeUndefined();
    await expect(on.mint(RIDE, 'w', '1h', 0b111, 1.5)).resolves.toBeUndefined();
    await expect(on.mint('not-a-uuid', 'w', '1h', 0b111, 20_000)).resolves.toBeUndefined();
  });
});
