import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { VerdictStatus } from '../../../../domain/verdict/verdict.dto.js';
import { VerdictService, type ReplayQueueProcessResult } from '../../../services/verdict.service.js';
import { ProcessReplayQueueCommand } from './process-replay-queue.command.js';

@CommandHandler(ProcessReplayQueueCommand)
export class ProcessReplayQueueHandler implements ICommandHandler<ProcessReplayQueueCommand, ReplayQueueProcessResult> {
  constructor(private readonly verdicts: VerdictService) {}

  async execute(command: ProcessReplayQueueCommand): Promise<ReplayQueueProcessResult> {
    if (command.rideId) {
      const v = await this.verdicts.judge(command.rideId);
      return {
        processed: v ? 1 : 0,
        verified: v?.status === VerdictStatus.Verified ? 1 : 0,
        flagged: v?.status === VerdictStatus.Flagged ? 1 : 0,
        rejected: v?.status === VerdictStatus.Rejected ? 1 : 0,
        failed: 0,
      };
    }
    return this.verdicts.processQueue(command.limit, command.concurrency);
  }
}
