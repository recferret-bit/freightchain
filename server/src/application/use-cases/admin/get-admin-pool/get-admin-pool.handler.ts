import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminPoolDetailDto } from '../../../../domain/admin/admin.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { AdminDirectoryPort } from '../../../ports/admin/admin-directory.port.js';
import { GetAdminPoolQuery } from './get-admin-pool.query.js';

/** One pool with its split, treasuries and ticket holders (unused + bought tickets per wallet). */
@QueryHandler(GetAdminPoolQuery)
export class GetAdminPoolHandler implements IQueryHandler<GetAdminPoolQuery, AdminPoolDetailDto> {
  constructor(private readonly directory: AdminDirectoryPort) {}

  async execute({ id }: GetAdminPoolQuery): Promise<AdminPoolDetailDto> {
    const pool = await this.directory.pool(id);
    if (!pool) throw new NotFoundError(`no pool ${id}`);
    return pool;
  }
}
