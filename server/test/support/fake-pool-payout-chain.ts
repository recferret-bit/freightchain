import { ConflictError, ServiceUnavailableError } from '../../src/domain/shared/errors.js';
import { PoolPayoutChainPort, type SignedPayout } from '../../src/application/ports/economy/pool-payout-chain.port.js';
import { newPoolSignature, type FakePoolChain } from './fake-pool-chain.js';

/**
 * The payout key as a test double on top of a FakePoolChain: `payPrize` checks what the program would (active, payout_at reached by `now`, the prize cap), calls
 * `onSigned` BEFORE "broadcasting", then moves the lamports on the fake account and puts a PrizePaid transaction on its history; `closePool` settles the pool.
 * `address` null = no PAYOUT_SECRET (the default). `named` = what the program's Config says (defaults to the key itself).
 */
export class FakePoolPayoutChain extends PoolPayoutChainPort {
  payoutAddress: string | null = null;
  named: string | null | undefined = undefined;
  now = new Date(0);
  /** prize ranks / 'close' that fail on "chain" before anything is signed (a refused simulation) */
  readonly failing = new Set<string>();
  /** ranks whose broadcast is "dropped" after signing (the blockhash expires: transaction_dropped) */
  readonly dropping = new Set<number>();
  readonly prizes: { poolId: number; to: string; lamports: number; rank: number; signature: string }[] = [];
  readonly closed: number[] = [];

  constructor(private readonly chain: FakePoolChain) { super(); }

  get address(): string | null { return this.payoutAddress; }
  async chainNow(): Promise<Date> { return this.now; }
  async configuredPayoutAuthority(): Promise<string | null> { return this.named === undefined ? this.payoutAddress : this.named; }

  async payPrize(i: { poolId: number; to: string; lamports: number; rank: number }, onSigned: (tx: SignedPayout) => Promise<void>): Promise<{ signature: string }> {
    if (!this.payoutAddress) throw new ServiceUnavailableError('no payout key');
    const pool = this.chain.pools.get(i.poolId);
    if (!pool || pool.status !== 'active') throw new ConflictError(`pay_prize #${i.rank} of pool ${i.poolId} would fail: PoolNotActive`, 'transaction_would_fail');
    if (this.now.getTime() < pool.payoutAt.getTime()) throw new ConflictError(`pay_prize #${i.rank} of pool ${i.poolId} would fail: TooEarly`, 'transaction_would_fail');
    if (this.failing.has(String(i.rank))) throw new ConflictError(`pay_prize #${i.rank} of pool ${i.poolId} would fail: scripted`, 'transaction_would_fail');
    const signature = newPoolSignature();
    await onSigned({ signature, lastValidBlockHeight: this.chain.lastValidBlockHeight });
    if (this.dropping.has(i.rank)) { this.dropping.delete(i.rank); this.chain.statuses.set(signature, 'expired'); throw new ConflictError(`pay_prize #${i.rank} was dropped`, 'transaction_dropped'); }
    const prizesPaid = pool.prizesPaid + i.lamports;
    this.chain.pools.set(i.poolId, { ...pool, prizesPaid, vaultLamports: pool.vaultLamports - i.lamports, escrowLamports: pool.escrowLamports - i.lamports });
    this.chain.addTransaction([{ kind: 'PrizePaid', poolId: i.poolId, to: i.to, lamports: i.lamports, rank: i.rank, prizesPaidTotal: prizesPaid }], signature);
    this.chain.statuses.set(signature, 'confirmed');
    this.prizes.push({ ...i, signature });
    return { signature };
  }

  async closePool(poolId: number): Promise<{ signature: string }> {
    const pool = this.chain.pools.get(poolId);
    if (!pool || pool.status !== 'active' || this.failing.has('close')) throw new ConflictError(`close_pool ${poolId} would fail`, 'transaction_would_fail');
    this.chain.pools.set(poolId, { ...pool, status: 'settled', vaultLamports: 0, escrowLamports: 0 });
    this.closed.push(poolId);
    return { signature: this.chain.addTransaction([{ kind: 'PoolClosed', poolId, prizePaid: pool.prizesPaid, seed: 0, fee: 0, platformFee: 0, unclaimed: 0, rentReturned: 890_880, cancelled: false }]) };
  }
}
