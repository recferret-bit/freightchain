import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { grantReleasable } from '../../domain/anticheat/trust-score.js';
import { ReferralEmissionPort } from '../ports/honk/referral-emission.port.js';
import { HonkRepositoryPort } from '../ports/honk/honk.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EntropyPort } from '../ports/shared/entropy.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { ConvoyRepositoryPort, type ConvoyLedgerRow } from './convoy.repository.port.js';
import { ReleaseConvoyCommand } from './release-convoy.command.js';

const HOLD_MS = 48 * 3_600_000, LEASE_MS = 120_000;

/** PostgreSQL records signed submissions before broadcast; only a receipt credits the spendable ledger. */
@CommandHandler(ReleaseConvoyCommand)
export class ReleaseConvoyHandler implements ICommandHandler<ReleaseConvoyCommand, number> {
  private readonly log = new Logger(ReleaseConvoyHandler.name);
  constructor(
    private readonly repo: ConvoyRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly emission: ReferralEmissionPort,
    private readonly honk: HonkRepositoryPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute(_command: ReleaseConvoyCommand): Promise<number> {
    if (!this.emission.enabled()) return 0;
    const now = this.clock.now();
    const pending = await this.repo.pendingSettlements(now, new Date(now.getTime() - HOLD_MS), 50);
    let paid = 0;
    for (const candidate of pending) {
      const row = await this.transactions.run(async (tx) => {
        const eligible = await this.lockAndCheck(candidate, tx);
        const fresh = await this.repo.findLedger(candidate.id, tx);
        const at = this.clock.now();
        if (!fresh || fresh.chainState !== 'held' || (fresh.chainRetryAt && fresh.chainRetryAt > at)) return null;
        const next = { ...fresh, chainLeaseId: this.entropy.uuid(), chainRetryAt: new Date(at.getTime() + LEASE_MS) };
        if (!await this.repo.saveSettlement(next, fresh.chainLeaseId ?? null, tx)) return null;
        // Reconcile an already signed transaction even if trust changed after it landed.
        return eligible || fresh.chainSignature ? next : null;
      });
      if (!row) continue;
      try {
        const result = await this.emission.settle({
          rewardId: row.id, wallet: row.wallet, baseAmount: BigInt(row.amount) * 1_000_000n, now: this.clock.now(),
          submitted: row.chainSignature && row.chainLastValidBlockHeight !== null && row.chainLastValidBlockHeight !== undefined ? { signature: row.chainSignature, lastValidBlockHeight: row.chainLastValidBlockHeight } : null,
          onSubmitted: async (submission) => {
            await this.transactions.run(async (tx) => {
              if (!await this.lockAndCheck(row, tx)) throw new Error('referral trust hold');
              const current = await this.repo.findLedger(row.id, tx);
              if (!current || current.chainState !== 'held' || current.chainLeaseId !== row.chainLeaseId) throw new Error('referral lease lost');
              const saved = await this.repo.saveSettlement({ ...current, chainSignature: submission.signature, chainLastValidBlockHeight: submission.lastValidBlockHeight }, row.chainLeaseId, tx);
              if (!saved) throw new Error('referral submission was not persisted');
            });
          },
        });
        const credited = await this.transactions.run(async (tx) => {
          await this.lockAndCheck(row, tx);
          const current = await this.repo.findLedger(row.id, tx);
          if (!current || current.chainState !== 'held' || current.chainLeaseId !== row.chainLeaseId) return false;
          const at = this.clock.now();
          const amount = result.kind === 'paid' ? result.amount : 0n;
          if (result.kind === 'paid' && (amount <= 0n || amount > BigInt(row.amount) * 1_000_000n)) throw new Error('invalid referral payment');
          if (!await this.repo.saveSettlement({ ...current, chainState: result.kind, paidUnits: amount, chainResolvedAt: at, releasedAt: result.kind === 'paid' ? at : null, capReason: result.kind === 'capped' ? result.reason : null, chainRetryAt: null, chainLeaseId: null }, row.chainLeaseId, tx)) return false;
          if (amount > 0n) await this.honk.credit(row.wallet, amount, at, tx);
          return amount > 0n;
        });
        if (credited) paid += 1;
      } catch {
        this.log.warn({ event: 'convoy-settlement-pending', rewardId: row.id });
      }
    }
    return paid;
  }

  private async lockAndCheck(row: ConvoyLedgerRow, tx: TransactionHandle): Promise<boolean> {
    const scores = new Map<string, { trustScore: number; rejectedRides: number }>();
    for (const wallet of [...new Set([row.referrer, row.referee])].sort()) {
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new Error('referral player missing');
      scores.set(wallet, player);
    }
    const a = scores.get(row.referrer)!, b = scores.get(row.referee)!;
    return grantReleasable({ trustA: a.trustScore, trustB: b.trustScore, rejectedA: a.rejectedRides, rejectedB: b.rejectedRides, now: this.clock.now(), heldAt: row.at });
  }
}
