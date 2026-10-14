import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { jobDto, type EditorJobDto } from '../../../../domain/editor/editor-job.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { EditorJobRepositoryPort } from '../../../ports/editor/editor-job.repository.port.js';
import { GetEditorJobQuery } from './get-editor-job.query.js';

@QueryHandler(GetEditorJobQuery)
export class GetEditorJobHandler implements IQueryHandler<GetEditorJobQuery, EditorJobDto> {
  constructor(private readonly jobs: EditorJobRepositoryPort) {}

  async execute({ jobId }: GetEditorJobQuery): Promise<EditorJobDto> {
    const job = await this.jobs.find(jobId);
    if (!job) throw new NotFoundError('no such job', 'job_not_found');
    return jobDto(job);
  }
}
