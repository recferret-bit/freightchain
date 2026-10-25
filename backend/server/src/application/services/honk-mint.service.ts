import { Injectable, Optional } from '@nestjs/common';
import { bandAmounts, bandBits, clipPayout, dayStart, holdMs } from '../../domain/honk/tokenomics.js';
import { HonkRepositoryPort, type HonkMintInput, type HonkMintRow } from '../ports/honk/honk.repository.port.js';
import { HonkEmissionPort } from '../ports/honk/honk-emission.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';

/** Credits TEN4 for a verified paid ride. Idempotent on rideId. An 8h mint is reserved until releaseAt; a reject before that returns the reservation. A released mint is not clawed back. */
@Injectable()
export class HonkMintService {
  constructor(
    private readonly honk: HonkRepositoryPort,
    private readonly clock: ClockPort,
    @Optional() private readonly emission?: HonkEmissionPort,
  ) {}

  /** The amount just credited to the wallet, or null when nothing was credited (already minted, no band, a closed cap, or an 8h reservation). */
  async credit(input: HonkMintInput, tx?: TransactionHandle): Promise<bigint | null> {
    const prior = await this.honk.findMint(input.rideId, tx);
    if (prior) return null;
    const emitted = await this.honk.lockEmission(tx);
    const start = dayStart(this.clock.now());
    const dayGlobal = await this.honk.emittedOnDay(start, null, tx);
    const dayWallet = await this.honk.emittedOnDay(start, input.wallet, tx);
    const { bands, quote } = bandAmounts(input.tier, input.distance, input.completeDist, emitted);
    const { amount } = clipPayout(quote, emitted, dayGlobal, dayWallet);
    if (amount <= 0n) return null;
    const at = this.clock.now();
    const wait = holdMs(input.tier);
    const row: HonkMintRow = {
      rideId: input.rideId, wallet: input.wallet, tier: input.tier, amount, createdAt: at,
      band20: bands.some((b) => b.pct === 20 && b.reached),
      band50: bands.some((b) => b.pct === 50 && b.reached),
      band100: bands.some((b) => b.pct === 100 && b.reached),
      releaseAt: new Date(at.getTime() + wait),
      released: wait === 0,
      chainPending: this.emission?.enabled() ?? false,
    };
    if (!(await this.honk.insertMint(row, tx))) return null;
    await this.honk.addEmission(amount, tx);
    if (!row.released) return null;
    await this.honk.credit(input.wallet, amount, at, tx);
    return amount;
  }

  /** Credits a reservation whose releaseAt has passed. Does not add emission again. */
  async releaseIfDue(rideId: string, tx?: TransactionHandle): Promise<bigint | null> {
    const row = await this.honk.findMint(rideId, tx);
    if (!row || row.released || row.releaseAt.getTime() > this.clock.now().getTime()) return null;
    if (!(await this.honk.markReleased(rideId, tx))) return null;
    await this.honk.credit(row.wallet, row.amount, this.clock.now(), tx);
    return row.amount;
  }

  /** Drops an unreleased 8h reservation and returns its emission. A released row stays. */
  async cancelPending(rideId: string, tx?: TransactionHandle): Promise<bigint | null> {
    const row = await this.honk.findMint(rideId, tx);
    if (!row || row.released) return null;
    if (!(await this.honk.deleteMint(rideId, tx))) return null;
    await this.honk.subEmission(row.amount, tx);
    return row.amount;
  }

  /** Tier and band bits for a released row, so the program can derive the amount itself. */
  async chainOf(rideId: string): Promise<{ tier: string; bands: number } | null> {
    const row = await this.honk.findMint(rideId);
    if (!row?.released) return null;
    return { tier: row.tier, bands: bandBits(row) };
  }
}
