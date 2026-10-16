import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { jobDto, type EditorJobDto } from '../../../../domain/editor/editor-job.js';
import { EditorJobRepositoryPort } from '../../../ports/editor/editor-job.repository.port.js';
import { ListEditorJobsQuery } from './list-editor-jobs.query.js';

@QueryHandler(ListEditorJobsQuery)
export class ListEditorJobsHandler implements IQueryHandler<ListEditorJobsQuery, EditorJobDto[]> {
  constructor(private readonly jobs: EditorJobRepositoryPort) {}

  async execute({ wallet, entityId }: ListEditorJobsQuery): Promise<EditorJobDto[]> {
    return (await this.jobs.list({ wallet, ...(entityId ? { entityId } : {}), limit: 50 })).map(jobDto);
  }
}
