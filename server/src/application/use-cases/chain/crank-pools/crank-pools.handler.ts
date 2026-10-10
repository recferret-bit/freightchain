import { Logger } from '@nestjs/common';
import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { PoolChainState } from '../../../../domain/economy/chain-events.js';
import { REFUND_BATCH, nextCrankStep, type CrankStep } from '../../../../domain/economy/pool-crank.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { PoolCrankChainPort, type ChainTicket } from '../../../ports/economy/pool-crank-chain.port.js';
import { SettleChainSignatureCommand, type SettledSignatureDto } from '../settle-chain-signature/settle-chain-signature.command.js';
import { CrankPoolsCommand, type CrankActionDto, type CrankPassDto } from './crank-pools.command.js';

/** a pool needs at most fail/expire + ⌈tickets / 8⌉ refunds + close; the cap only stops a loop if the chain and the rule ever disagree */
const MAX_STEPS_PER_POOL = 200;

/**
 * One crank pass: for every pool on chain (not only the mirror – the chain wins), by the CHAIN clock, send the next permissionless step (nextCrankStep) and
 * read the pool again, until nothing is left or a step fails (the next pass retries it). Each signature is settled at once (SettleChainSignatureCommand), so the
 * mirror – pool status, refunded tickets – follows without waiting for the watcher. No player row lock here: settling takes the locks it needs; the program
 * makes every step idempotent (a refund that raced the player's own CLAIM REFUND fails as a whole and the next pass rebuilds the batch from the tickets left).
 */
@CommandHandler(CrankPoolsCommand)
export class CrankPoolsHandler implements ICommandHandler<CrankPoolsCommand, CrankPassDto> {
  private readonly log = new Logger(CrankPoolsHandler.name);

  constructor(
    private readonly crank: PoolCrankChainPort,
    private readonly chain: PoolChainPort,
    private readonly commands: CommandBus,
  ) {}

  async execute(): Promise<CrankPassDto> {
    const address = this.crank.address;
    if (!address) return { enabled: false, crank: null, chainNow: null, actions: [] };
    const now = await this.crank.chainNow();
    const actions: CrankActionDto[] = [];
    for (const pool of await this.crank.listPools()) await this.crankPool(pool, now, actions);
    if (actions.length) this.log.log(`crank: ${actions.map((a) => `${a.step} #${a.poolId}${a.error ? ` ✗ ${a.error}` : ''}`).join(', ')}`);
    return { enabled: true, crank: address, chainNow: now.getTime(), actions };
  }

  /** the steps for one pool until nothing is left or one fails; returns how many were sent */
  private async crankPool(start: PoolChainState, now: Date, actions: CrankActionDto[]): Promise<number> {
    const before = actions.length;
    let pool: PoolChainState | null = start;
    let step: CrankStep | null = null;
    try {
      for (let n = 0; pool && n < MAX_STEPS_PER_POOL; n++) {
        step = nextCrankStep(pool, now);
        if (!step) break;
        if (step === 'refund') {
          const tickets = await this.crank.listTickets(pool.poolId);
          if (!tickets.length) { actions.push(failed(pool.poolId, step, 'the pool owes refunds but no Ticket account is left – check the pool by hand')); break; }
          let ok = true;
          for (let i = 0; ok && i < tickets.length; i += REFUND_BATCH) ok = await this.act(pool.poolId, step, actions, tickets.slice(i, i + REFUND_BATCH));
          if (!ok) break;
        } else if (!(await this.act(pool.poolId, step, actions))) break;
        pool = await this.chain.readPool(pool.poolId);
      }
    } catch (error) {
      // a refused read (getProgramAccounts on a provider that refuses it, a pool read that failed) stops THIS pool; the pools after it are still served
      actions.push(failed(start.poolId, step ?? 'refund', error instanceof Error ? error.message : String(error)));
    }
    return actions.length - before;
  }

  /** send one step and settle it; false = stop this pool for this pass */
  private async act(poolId: number, step: CrankStep, actions: CrankActionDto[], tickets: ChainTicket[] = []): Promise<boolean> {
    try {
      const { signature } = await this.crank.send({ step, poolId, tickets });
      const settled = await this.commands.execute<SettleChainSignatureCommand, SettledSignatureDto>(new SettleChainSignatureCommand(signature));
      actions.push({ poolId, step, signature, tickets: tickets.length, settled: settled.status, error: null });
      return true;
    } catch (error) {
      actions.push(failed(poolId, step, error instanceof Error ? error.message : String(error)));
      return false;
    }
  }
}

const failed = (poolId: number, step: CrankStep, error: string): CrankActionDto => ({ poolId, step, signature: null, tickets: 0, settled: null, error });
