import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { ChainEventRecord } from '../../../../domain/economy/chain-events.js';
import { ChainEventRepositoryPort } from '../../../ports/economy/chain-event.repository.port.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { PoolRegistryService } from '../../../services/pool-registry.service.js';
import { TicketSettlementService, type SettleOutcome } from '../../../services/ticket-settlement.service.js';
import { SettleChainSignatureCommand, type SettledEventDto, type SettledSignatureDto } from './settle-chain-signature.command.js';

/**
 * One transaction's program events, in order: each goes to the settlement (which is idempotent – a replay changes nothing) and is recorded in the event log.
 * An event of a pool the mirror does not know yet registers that pool from its account and is retried once. Nothing observed is dropped silently: every
 * event becomes a ChainEvent row with its outcome; a failed / foreign transaction is answered `invalid`, one not visible yet `pending`.
 */
@CommandHandler(SettleChainSignatureCommand)
export class SettleChainSignatureHandler implements ICommandHandler<SettleChainSignatureCommand, SettledSignatureDto> {
  constructor(
    private readonly chain: PoolChainPort,
    private readonly events: ChainEventRepositoryPort,
    private readonly settlement: TicketSettlementService,
    private readonly registry: PoolRegistryService,
    private readonly clock: ClockPort,
  ) {}

  async execute({ signature }: SettleChainSignatureCommand): Promise<SettledSignatureDto> {
    const read = await this.chain.readEvents(signature);
    if (read === 'pending') return { signature, status: 'pending', detail: null, events: [] };
    if (!Array.isArray(read)) return { signature, status: 'invalid', detail: read.invalid, events: [] };
    const settled: SettledEventDto[] = [];
    for (const e of read) {
      let r = await this.settle(e);
      if (r.outcome === 'unmatched' && (await this.registry.syncFromChain(e.poolId))) r = await this.settle(e);
      const orderId = 'order' in r ? r.order?.id ?? null : null;
      const detail = 'detail' in r ? r.detail ?? null : null;
      await this.events.record({
        signature, index: e.index, kind: e.kind, poolId: e.poolId, wallet: walletOf(e), orderId, lamports: lamportsOf(e), outcome: r.outcome, detail,
        at: this.clock.now(), finalizedAt: null, lastValidBlockHeight: null,
      });
      settled.push({ index: e.index, kind: e.kind, poolId: e.poolId, outcome: r.outcome, orderId, detail });
    }
    return { signature, status: 'done', detail: null, events: settled };
  }

  private settle(e: ChainEventRecord): Promise<SettleOutcome> {
    if (e.kind === 'TicketBought') return this.settlement.settlePurchase(e);
    if (e.kind === 'Refunded') return this.settlement.settleRefund(e);
    return this.settlement.applyPoolEvent(e);
  }
}

const walletOf = (e: ChainEventRecord): string | null =>
  e.kind === 'TicketBought' || e.kind === 'Refunded' ? e.buyer : e.kind === 'Sponsored' || e.kind === 'SponsorRefunded' ? e.sponsor : e.kind === 'PrizePaid' ? e.to
    : e.kind === 'RideAttestationRecorded' ? e.driver : null;

const lamportsOf = (e: ChainEventRecord): number | null =>
  e.kind === 'TicketBought' || e.kind === 'Refunded' || e.kind === 'Sponsored' || e.kind === 'PrizePaid' || e.kind === 'SponsorRefunded' ? e.lamports
    : e.kind === 'WinnersCommitted' ? e.total : null;
