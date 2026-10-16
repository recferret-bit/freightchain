import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { bandBits, dayIndex } from '../../../domain/honk/tokenomics.js';
import { HonkEmissionPort } from '../../ports/honk/honk-emission.port.js';
import { HonkRepositoryPort, type HonkMintRow } from '../../ports/honk/honk.repository.port.js';
import { PlayerRepositoryPort } from '../../ports/players/player.repository.port.js';
import { ClockPort } from '../../ports/shared/clock.port.js';
import { TransactionPort } from '../../ports/shared/transaction.port.js';
import { HonkMintService } from '../../services/honk-mint.service.js';
import { ReleaseHonkCommand } from './release-honk.command.js';

const BATCH = 50;

/** Releases due 8h reservations. Chain emission runs only after the wallet credit commits, and only for rows this call released. */
@CommandHandler(ReleaseHonkCommand)
export class ReleaseHonkHandler implements ICommandHandler<ReleaseHonkCommand, number> {
  constructor(
    private readonly honk: HonkRepositoryPort,
    private readonly mints: HonkMintService,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly emission: HonkEmissionPort,
    private readonly clock: ClockPort,
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
          if (await this.mints.releaseIfDue(row.rideId, tx)) out.push(row);
        }
        return out;
      });
      const day = dayIndex(this.clock.now());
      for (const row of paid) await this.emission.mint(row.rideId, wallet, row.tier, bandBits(row), day);
      released += paid.length;
    }
    return released;
  }
}
