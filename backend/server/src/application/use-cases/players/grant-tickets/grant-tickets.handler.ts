import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { PoolTicketsService } from '../../../services/pool-tickets.service.js';
import { withVersionRetry } from '../../../services/version-retry.js';
import { GrantTicketsCommand, type TicketsGrantedDto } from './grant-tickets.command.js';

/** Admin (CLI): gift tickets into a live pool (clamped at its per-wallet cap; an `admin` audit line). A wallet that never signed in is registered first. */
@CommandHandler(GrantTicketsCommand)
export class GrantTicketsHandler implements ICommandHandler<GrantTicketsCommand, TicketsGrantedDto> {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly poolTickets: PoolTicketsService,
    private readonly sessions: PlayerSessionService,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet: typed, poolId, count, note }: GrantTicketsCommand): Promise<TicketsGrantedDto> {
    const wallet = parseWalletAddress(typed);
    if (!Number.isInteger(count) || count < 1) throw new BadRequestError('grant at least 1 ticket');
    await this.sessions.touch(wallet);
    return withVersionRetry(() => this.transactions.run(async (tx) => {
      const now = this.clock.now();
      if (!(await this.players.findByWalletForUpdate(wallet, tx))) throw new NotFoundError('player not found');
      const pool = await this.pools.findById(poolId, tx);
      if (!pool) throw new NotFoundError(`no pool ${poolId}`);
      if (pool.status !== 'open' && pool.status !== 'active') throw new ConflictError(`pool ${poolId} is ${pool.status}`, 'pool_closed');
      const { added, balance } = await this.poolTickets.grant(wallet, pool, count, 'admin', note, now, tx);
      return { wallet, poolId, added, balance, cap: pool.maxPerWallet };
    }));
  }
}
