import { Injectable } from '@nestjs/common';
import { bandAmounts, clipToCap } from '../../domain/honk/tokenomics.js';
import { HonkRepositoryPort, type HonkMintInput, type HonkMintRow } from '../ports/honk/honk.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';

/** Credits HONK for a verified paid ride. Idempotent on rideId. A later reject is not clawed back (the coins may already be burned). */
@Injectable()
export class HonkMintService {
  constructor(
    private readonly honk: HonkRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async credit(input: HonkMintInput, tx?: TransactionHandle): Promise<HonkMintRow | null> {
    const prior = await this.honk.findMint(input.rideId, tx);
    if (prior) return prior;
    const { bands, quote } = bandAmounts(input.tier, input.distance, input.completeDist);
    const amount = clipToCap(quote, await this.honk.lockEmission(tx));
    if (amount <= 0n) return null;
    const at = this.clock.now();
    const row: HonkMintRow = {
      rideId: input.rideId, wallet: input.wallet, tier: input.tier, amount, createdAt: at,
      band20: bands.some((b) => b.pct === 20 && b.reached),
      band50: bands.some((b) => b.pct === 50 && b.reached),
      band100: bands.some((b) => b.pct === 100 && b.reached),
    };
    if (!(await this.honk.insertMint(row, tx))) return this.honk.findMint(input.rideId, tx);
    await this.honk.addEmission(amount, tx);
    await this.honk.credit(input.wallet, amount, at, tx);
    return row;
  }
}
