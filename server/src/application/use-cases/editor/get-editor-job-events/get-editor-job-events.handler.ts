import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { eventDto, type JobEventsDto } from '../../../../domain/editor/editor-job.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { EditorJobRepositoryPort } from '../../../ports/editor/editor-job.repository.port.js';
import { GetEditorJobEventsQuery } from './get-editor-job-events.query.js';

const PAGE = 200;

@QueryHandler(GetEditorJobEventsQuery)
export class GetEditorJobEventsHandler implements IQueryHandler<GetEditorJobEventsQuery, JobEventsDto> {
  constructor(private readonly jobs: EditorJobRepositoryPort) {}

  async execute({ jobId, after }: GetEditorJobEventsQuery): Promise<JobEventsDto> {
    const job = await this.jobs.find(jobId);
    if (!job) throw new NotFoundError('no such job', 'job_not_found');
    return { status: job.status, events: (await this.jobs.events(jobId, after, PAGE)).map(eventDto) };
  }
}
