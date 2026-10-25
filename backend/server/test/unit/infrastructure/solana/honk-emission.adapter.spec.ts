import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { HonkEmissionAdapter } from '../../../../src/infrastructure/solana/honk-emission.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const RIDE = '00000000-0000-4000-8000-000000000001';
const PROGRAM = 'GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx';
const wallet = Keypair.generate().publicKey;
const secret = () => JSON.stringify(Array.from(Keypair.generate().secretKey));
const env = (over: Partial<EnvService> = {}) => ({ solanaRpc: 'http://127.0.0.1:1', honkProgramId: undefined, honkEmitterSecret: undefined, ...over }) as EnvService;
const on = () => new HonkEmissionAdapter(env({ honkProgramId: PROGRAM, honkEmitterSecret: secret() }));
const receipt = () => {
  const data = Buffer.alloc(52);
  createHash('sha256').update('account:RideMint').digest().copy(data, 0, 0, 8);
  data.writeBigUInt64LE(100_000_000n, 8);
  wallet.toBuffer().copy(data, 16);
  data[48] = 1; data[49] = 7;
  return { data, owner: new PublicKey(PROGRAM), lamports: 1, executable: false };
};

describe('HonkEmissionAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stays off without both program and emitter', async () => {
    const off = new HonkEmissionAdapter(env());
    expect(off.enabled()).toBe(false);
    await expect(off.mint(RIDE, 'w', '1h', 7, 20_000)).resolves.toBeUndefined();
    expect(new HonkEmissionAdapter(env({ honkProgramId: PROGRAM })).enabled()).toBe(false);
    expect(new HonkEmissionAdapter(env({ honkEmitterSecret: secret() })).enabled()).toBe(false);
  });

  it('refuses invalid requests instead of acknowledging an unpaid reward', async () => {
    const adapter = on();
    for (const args of [
      [RIDE, wallet.toBase58(), 'free', 7, 20_000, 1n], [RIDE, wallet.toBase58(), '1h', 8, 20_000, 1n],
      [RIDE, wallet.toBase58(), '1h', 7, -1, 1n], [RIDE, wallet.toBase58(), '1h', 7, 1.5, 1n],
      ['bad', wallet.toBase58(), '1h', 7, 20_000, 1n], [RIDE, wallet.toBase58(), '1h', 7, 20_000, undefined],
    ] as const) await expect(adapter.mint(args[0], args[1], args[2], args[3], args[4], args[5])).rejects.toThrow();
  });

  it('recovers a landed transaction from its confirmed receipt without sending again', async () => {
    const read = vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(receipt());
    await expect(on().mint(RIDE, wallet.toBase58(), '1h', 7, 20_000, 100_000_000n)).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[1]).toBe('confirmed');
  });

  it.each(['owner', 'discriminator', 'amount', 'recipient', 'tier', 'bands', 'size'])('refuses a receipt with the wrong %s', async (field) => {
    const account = receipt();
    if (field === 'owner') account.owner = wallet;
    else if (field === 'size') account.data = Buffer.alloc(20);
    else account.data[{ discriminator: 0, amount: 8, recipient: 16, tier: 48, bands: 49 }[field]!] ^= 1;
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(account);
    await expect(on().mint(RIDE, wallet.toBase58(), '1h', 7, 20_000, 100_000_000n)).rejects.toThrow('receipt mismatch');
  });
});
