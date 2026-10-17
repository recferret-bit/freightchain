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

/** Releases due 8h reservations. Chain emission runs only after the wallet credit commits, and only for rows this call released. */
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
      const day = dayIndex(this.clock.now());
      for (const row of paid) {
        try {
          await this.emission.mint(row.rideId, wallet, row.tier, bandBits(row), day);
        } catch (error) {
          this.logger.warn(`chain mint after 8h release failed for ride ${row.rideId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      released += paid.length;
    }
    return released;
  }
}
