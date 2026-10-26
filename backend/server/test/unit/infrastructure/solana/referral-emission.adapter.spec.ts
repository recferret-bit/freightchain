import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { ReferralEmissionAdapter } from '../../../../src/infrastructure/solana/referral-emission.adapter.js';
import type { ReferralPayment } from '../../../../src/application/ports/honk/referral-emission.port.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const rpc = vi.hoisted(() => ({ height: vi.fn(async () => 100) }));
vi.mock('@solana/web3.js', async (original) => {
  const mod = await original<typeof import('@solana/web3.js')>();
  return { ...mod, Connection: class extends mod.Connection { override getBlockHeight = rpc.height; } };
});

const program = new PublicKey('GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx');
const key = Keypair.generate(), wallet = Keypair.generate().publicKey;
const now = new Date('2026-10-25T12:00:00Z');
const env = { solanaRpc: 'http://127.0.0.1:1', honkProgramId: program.toBase58(), honkEmitterSecret: JSON.stringify([...key.secretKey]) } as EnvService;
const payment = (over: Partial<ReferralPayment> = {}): ReferralPayment => ({ rewardId: 'convoy:m1:friend', wallet: wallet.toBase58(), baseAmount: 100_000_000n, now, submitted: null, onSubmitted: vi.fn(async () => {}), ...over });
const account = (data: Buffer) => ({ data, owner: program, executable: false, lamports: 1 });
const disc = (name: string) => createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
const receipt = () => {
  const d = Buffer.alloc(50); disc('ReferralMint').copy(d); wallet.toBuffer().copy(d, 8); d.writeBigUInt64LE(50_000_000n, 40); return account(d);
};
const config = () => {
  const d = Buffer.alloc(211); disc('Config').copy(d); key.publicKey.toBuffer().copy(d, 9); d.writeBigInt64LE(BigInt(now.getTime() / 1000 - 86400), 187); return account(d);
};
const status = (code: number | null, confirmationStatus: 'confirmed' | 'processed' = 'confirmed') => ({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 1, err: code === null ? null : { InstructionError: [1, { Custom: code }] }, confirmationStatus }] }) as Awaited<ReturnType<Connection['getSignatureStatuses']>>;

function sending() {
  vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValueOnce(null).mockResolvedValueOnce(config()).mockResolvedValueOnce(receipt());
  vi.spyOn(Connection.prototype, 'getLatestBlockhash').mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 });
  const send = vi.spyOn(Connection.prototype, 'sendRawTransaction').mockResolvedValue('ignored');
  vi.spyOn(Connection.prototype, 'confirmTransaction').mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
  return send;
}

describe('ReferralEmissionAdapter', () => {
  it('accepts configured integer milestone amounts but rejects zero, fractional or over-cap base amounts', async () => {
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(receipt());
    expect(await new ReferralEmissionAdapter(env).settle(payment({ baseAmount: 75_000_000n }))).toEqual({ kind: 'paid', amount: 50_000_000n });
    for (const baseAmount of [0n, 1_000_001n, 1_001_000_000n]) await expect(new ReferralEmissionAdapter(env).settle(payment({ baseAmount }))).rejects.toThrow('invalid referral');
  });
  afterEach(() => vi.restoreAllMocks());
  it('recovers an existing receipt without broadcasting and reports its actual clipped amount', async () => {
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(receipt());
    const send = vi.spyOn(Connection.prototype, 'sendRawTransaction');
    await expect(new ReferralEmissionAdapter(env).settle(payment())).resolves.toEqual({ kind: 'paid', amount: 50_000_000n });
    expect(send).not.toHaveBeenCalled();
  });
  it.each(['owner', 'size', 'recipient', 'discriminator', 'zero', 'over'])('rejects an invalid receipt (%s)', async (field) => {
    const r = receipt();
    if (field === 'owner') r.owner = wallet;
    else if (field === 'size') r.data = Buffer.alloc(49);
    else if (field === 'recipient') r.data[8] ^= 1;
    else if (field === 'discriminator') r.data[0] ^= 1;
    else r.data.writeBigUInt64LE(field === 'zero' ? 0n : 100_000_001n, 40);
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(r);
    await expect(new ReferralEmissionAdapter(env).settle(payment())).rejects.toThrow('receipt');
  });
  it('persists the signed transaction before broadcasting; a callback failure prevents broadcast', async () => {
    const send = sending();
    const submitted = vi.fn(async ({ signature }: { signature: string }) => { expect(signature.length).toBeGreaterThan(60); expect(send).not.toHaveBeenCalled(); throw new Error('database down'); });
    await expect(new ReferralEmissionAdapter(env).settle(payment({ onSubmitted: submitted }))).rejects.toThrow('database down');
    expect(submitted).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
  it('submits only after persistence and reconciles the confirmed receipt', async () => {
    const send = sending();
    const submitted = vi.fn(async () => { expect(send).not.toHaveBeenCalled(); });
    await expect(new ReferralEmissionAdapter(env).settle(payment({ onSubmitted: submitted }))).resolves.toEqual({ kind: 'paid', amount: 50_000_000n });
    expect(send).toHaveBeenCalledOnce();
    expect(submitted).toHaveBeenCalledOnce();
  });
  it.each([[6000, 'emission'], [6006, 'emission'], [6007, 'monthly'], [6008, 'wallet']] as const)('records only confirmed cap failure %i as terminal', async (code, reason) => {
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(null);
    vi.spyOn(Connection.prototype, 'getSignatureStatuses').mockResolvedValue(status(code));
    await expect(new ReferralEmissionAdapter(env).settle(payment({ submitted: { signature: 'old', lastValidBlockHeight: 100 } }))).resolves.toEqual({ kind: 'capped', reason });
  });
  it('does not resend a possibly pending signature, or mistake generic failure for a cap', async () => {
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(null);
    const statuses = vi.spyOn(Connection.prototype, 'getSignatureStatuses').mockResolvedValue(status(null, 'processed'));
    const p = payment({ submitted: { signature: 'old', lastValidBlockHeight: 100 } });
    await expect(new ReferralEmissionAdapter(env).settle(p)).rejects.toThrow('still pending');
    statuses.mockResolvedValue(status(6010));
    await expect(new ReferralEmissionAdapter(env).settle(p)).rejects.toThrow('transaction failed');
    expect(p.onSubmitted).not.toHaveBeenCalled();
  });
  it('requires finalized expiry before replacing a missing signature', async () => {
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(null);
    vi.spyOn(Connection.prototype, 'getSignatureStatuses').mockResolvedValue({ context: { slot: 1 }, value: [null] });
    rpc.height.mockResolvedValue(100);
    await expect(new ReferralEmissionAdapter(env).settle(payment({ submitted: { signature: 'old', lastValidBlockHeight: 100 } }))).rejects.toThrow('still pending');
  });
  it('keeps configuration errors retryable instead of silently disabling a configured emitter', async () => {
    const broken = new ReferralEmissionAdapter({ ...env, honkProgramId: wallet.toBase58() } as EnvService);
    expect(broken.enabled()).toBe(true);
    await expect(broken.settle(payment())).rejects.toThrow('invalid referral');
    expect(new ReferralEmissionAdapter({ ...env, honkEmitterSecret: undefined } as unknown as EnvService).enabled()).toBe(false);
  });
});
