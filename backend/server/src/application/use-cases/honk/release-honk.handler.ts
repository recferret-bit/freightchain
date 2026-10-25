import { Logger, Optional } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { bandBits, dayIndex } from '../../../domain/honk/tokenomics.js';
import { VerdictStatus } from '../../../domain/verdict/verdict.dto.js';
import { HonkEmissionPort } from '../../ports/honk/honk-emission.port.js';
import { HonkRepositoryPort, type HonkMintRow } from '../../ports/honk/honk.repository.port.js';
import { PlayerRepositoryPort } from '../../ports/players/player.repository.port.js';
import { ClockPort } from '../../ports/shared/clock.port.js';
import { TransactionPort } from '../../ports/shared/transaction.port.js';
import { RideVerdictRepositoryPort } from '../../ports/verdict/ride-verdict.repository.port.js';
import { HonkMintService } from '../../services/honk-mint.service.js';
import { ReleaseHonkCommand } from './release-honk.command.js';

const BATCH = 50;

/** Releases due 8h reservations. Chain emission runs only after the wallet credit commits, and retries every durable pending emission. */
@CommandHandler(ReleaseHonkCommand)
export class ReleaseHonkHandler implements ICommandHandler<ReleaseHonkCommand, number> {
  private readonly logger = new Logger(ReleaseHonkHandler.name);

  constructor(
    private readonly honk: HonkRepositoryPort,
    private readonly mints: HonkMintService,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly emission: HonkEmissionPort,
    private readonly clock: ClockPort,
    @Optional() private readonly verdicts?: RideVerdictRepositoryPort,
  ) {}

  async execute(_command: ReleaseHonkCommand): Promise<number> {
    const due = await this.honk.listDue(this.clock.now(), BATCH);
    const byWallet = new Map<string, HonkMintRow[]>();
    for (const row of due) {
      const list = byWallet.get(row.wallet) ?? [];
      list.push(row);
      byWallet.set(row.wallet, list);
    }
    let released = 0;
    for (const [wallet, rows] of byWallet) {
      const paid = await this.transactions.run(async (tx) => {
        if (!(await this.players.findByWalletForUpdate(wallet, tx))) return [];
        const out: HonkMintRow[] = [];
        for (const row of rows) {
          if (this.verdicts) {
            const v = await this.verdicts.findByRide(row.rideId, tx);
            if (v && v.status !== VerdictStatus.Verified) {
              await this.mints.cancelPending(row.rideId, tx);
              continue;
            }
          }
          if (await this.mints.releaseIfDue(row.rideId, tx)) out.push(row);
        }
        return out;
      });
      released += paid.length;
    }
    await this.retryEmissions();
    return released;
  }

  private async retryEmissions(): Promise<void> {
    if (!this.emission.enabled()) return;
    const pending = await this.honk.listChainPending(this.clock.now(), BATCH);
    for (const candidate of pending) {
      const row = await this.transactions.run(async (tx) => {
        if (!(await this.players.findByWalletForUpdate(candidate.wallet, tx))) return null;
        const current = await this.honk.findMint(candidate.rideId, tx);
        const now = this.clock.now();
        if (!current?.released || !current.chainPending || (current.chainRetryAt && current.chainRetryAt > now)) return null;
        // Persist a bounded lease before RPC; a crashed worker is retried by the next process.
        await this.honk.deferChain(current.rideId, new Date(now.getTime() + 120_000), tx);
        return current;
      });
      if (!row) continue;
      try {
        await this.emission.mint(row.rideId, row.wallet, row.tier, bandBits(row), dayIndex(this.clock.now()), row.amount);
        await this.transactions.run(async (tx) => {
          if (await this.players.findByWalletForUpdate(row.wallet, tx)) await this.honk.markChainSent(row.rideId, this.clock.now(), tx);
        });
      } catch {
        this.logger.warn({ event: 'honk-emission-pending', rideId: row.rideId });
      }
    }
  }
}
