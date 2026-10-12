import { Injectable } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ConfirmPledgeCommand } from './confirm-pledge.command.js';
import { toPledgeDto, type PledgeDto } from '../../../../domain/economy/pledge.dto.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../../../domain/shared/errors.js';
import { PledgeRepositoryPort } from '../../../ports/economy/pledge.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';

/**
 * The sponsor's wallet sent the create_pledge: the row turns active only when THAT transaction's own events show this pledge's PledgeCreated with its terms
 * (the signature proves nothing by itself). Not visible yet = the row stays pending (ask again; the pledge job also finds it).
 */
@Injectable()
@CommandHandler(ConfirmPledgeCommand)
export class ConfirmPledgeHandler implements ICommandHandler<ConfirmPledgeCommand, PledgeDto> {
  constructor(
    private readonly pledges: PledgeRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly chain: PoolChainPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(c: ConfirmPledgeCommand): Promise<PledgeDto> {
    const before = await this.pledges.findById(c.pledgeId);
    if (!before) throw new NotFoundError('pledge not found');
    if (before.sponsor !== c.wallet) throw new ForbiddenError('only the sponsor confirms a pledge');
    const events = await this.chain.readPledgeEvents(c.signature);
    if (events === 'pending') return toPledgeDto(before);
    if (!Array.isArray(events)) throw new BadRequestError(`not a pledge transaction: ${events.invalid}`, 'pledge_tx_invalid');
    const mine = events.filter((e) => before.matches(e));
    if (!mine.some((e) => e.kind === 'PledgeCreated')) throw new BadRequestError('this transaction did not create this pledge', 'pledge_tx_invalid');
    return this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(before.sponsor, tx);
      const pledge = await this.pledges.findById(c.pledgeId, tx);
      if (!pledge) throw new NotFoundError('pledge not found');
      let changed = false;
      for (const e of mine) changed = pledge.apply(e, this.clock.now()) || changed;
      if (changed) await this.pledges.save(pledge, tx);
      return toPledgeDto(pledge);
    });
  }
}
