import { Injectable } from '@nestjs/common';
import { Round } from '../../domain/economy/round.entity.js';
import { RoundRepositoryPort } from '../ports/economy/round.repository.port.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { TransactionPort } from '../ports/shared/transaction.port.js';

/** Thrown inside the opening transaction when another request created this week's round first – rolls it back. */
class RoundRaceLost extends Error {}

/**
 * ONE global weekly round. The first request of a new week opens it, in ONE transaction: lock the previous round, read its entries, seed the new round with its
 * 20 % (an empty week passes its carry on), close it. A payment settling into the previous round holds the same lock (PaymentSettlementService), so it either
 * commits first – and is counted in the carry – or finds the round closed and goes to the new one.
 */
@Injectable()
export class RoundService {
  constructor(
    private readonly rounds: RoundRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async ensureRound(now: Date = this.clock.now()): Promise<Round> {
    const current = await this.rounds.findContaining(now);
    if (current) return current;
    try {
      return await this.transactions.run(async (tx) => {
        const previous = await this.rounds.findLatest(tx);
        let carry = this.rules.get().initialSeedLamports;
        if (previous) {
          await this.rounds.lockOpen(previous.id, tx); // waits for any payment still settling into it
          const entries = await this.rounds.entriesOf(previous.id, tx);
          carry = previous.carryOver(entries.lamports, entries.count);
        }
        const created = await this.rounds.insert(Round.open(now, carry), tx);
        if (!created) throw new RoundRaceLost();
        if (previous) {
          previous.close();
          await this.rounds.save(previous, tx);
        }
        return created;
      });
    } catch (error) {
      if (!(error instanceof RoundRaceLost)) throw error;
      const winner = await this.rounds.findContaining(now); // a concurrent request opened this week's round first – use that one
      if (!winner) throw new Error('the weekly round could neither be created nor found');
      return winner;
    }
  }
}
