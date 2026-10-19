import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { ChainCursorRepositoryPort } from '../../../ports/economy/chain-event.repository.port.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { FinalityService } from '../../../services/finality.service.js';
import { SettleChainSignatureCommand, type SettledSignatureDto } from '../settle-chain-signature/settle-chain-signature.command.js';
import { PollProgramCommand, type PollProgramResultDto } from './poll-program.command.js';

export const PROGRAM_CURSOR = 'program';
/** pages of `pageSize` per poll – a backlog larger than this is worked off over the next polls */
const MAX_PAGES = 10;
/** No cursor yet (first boot): catch up on the program's newest history this deep (one RPC page) – replaying what was settled already is harmless. */
const BOOTSTRAP_LIMIT = 1000;

/**
 * The watcher's poll (docs/spec/pool.md): from the 'program' cursor, the program's transactions OLDEST first → SettleChainSignatureCommand for each
 * successful one (failed ones are passed over – they moved no money). The cursor moves past a transaction only once it is done or invalid; one that is
 * still `pending` (not visible at the configured commitment) stops the batch there, so it is the first one asked next time. With no cursor yet (first boot)
 * the newest BOOTSTRAP_LIMIT transactions are replayed, oldest first – the whole history of a young program. Settling is idempotent, so the
 * webhook or the confirm fast path settling the same transaction first is harmless.
 * Errors: a deterministic one (400 / 404 / 409 – e.g. an account the mirror refuses) is reported in `errors` and passed over, so one bad transaction cannot
 * block the watcher forever (its events, if any were recorded, stay in the log); anything else (RPC down, database) stops the poll and is thrown – the cursor
 * stays before that transaction and the next poll retries it. Then the finality pass.
 */
@CommandHandler(PollProgramCommand)
export class PollProgramHandler implements ICommandHandler<PollProgramCommand, PollProgramResultDto> {
  constructor(
    private readonly chain: PoolChainPort,
    private readonly cursors: ChainCursorRepositoryPort,
    private readonly commands: CommandBus,
    private readonly finality: FinalityService,
    private readonly clock: ClockPort,
  ) {}

  async execute({ pageSize }: PollProgramCommand): Promise<PollProgramResultDto> {
    let cursor = (await this.cursors.get(PROGRAM_CURSOR))?.signature ?? null;
    let settled = 0, skipped = 0, pendingAt: string | null = null;
    const errors: PollProgramResultDto['errors'] = [];
    for (let page = 0; page < MAX_PAGES && pendingAt === null; page++) {
      const limit = cursor === null ? Math.max(pageSize, BOOTSTRAP_LIMIT) : pageSize;
      const batch = await this.chain.recentProgramSignatures(cursor, limit);
      for (const s of batch) {
        if (!s.failed) {
          const r = await this.settle(s.signature, errors);
          if (r === 'pending') { pendingAt = s.signature; break; }
          if (r === 'done') settled++; else skipped++;
        } else {
          skipped++;
        }
        cursor = s.signature;
        await this.cursors.set({ key: PROGRAM_CURSOR, signature: s.signature, slot: s.slot, at: this.clock.now() });
      }
      if (batch.length < limit) break;
    }
    const finality = await this.finality.pass();
    return { settled, skipped, pendingAt, cursor, errors, finality };
  }

  private async settle(signature: string, errors: PollProgramResultDto['errors']): Promise<SettledSignatureDto['status'] | 'error'> {
    try {
      return (await this.commands.execute<SettleChainSignatureCommand, SettledSignatureDto>(new SettleChainSignatureCommand(signature))).status;
    } catch (error) {
      if (!(error instanceof BadRequestError || error instanceof NotFoundError || error instanceof ConflictError)) throw error;
      errors.push({ signature, message: error.message });
      return 'error';
    }
  }
}
