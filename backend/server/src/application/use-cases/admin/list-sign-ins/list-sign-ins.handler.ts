import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { AdminListDto, SignInRowDto } from '../../../../domain/admin/admin.dto.js';
import { SignInRepositoryPort } from '../../../ports/auth/sign-in.repository.port.js';
import { ListSignInsQuery } from './list-sign-ins.query.js';

/** The sign-in log, newest first (optionally one wallet's): who signed in, when, with which pseudonymous network subnet. */
@QueryHandler(ListSignInsQuery)
export class ListSignInsHandler implements IQueryHandler<ListSignInsQuery, AdminListDto<SignInRowDto>> {
  constructor(private readonly signIns: SignInRepositoryPort) {}

  async execute({ limit, wallet }: ListSignInsQuery): Promise<AdminListDto<SignInRowDto>> {
    return { rows: (await this.signIns.recent(limit, wallet)).map((s) => ({ wallet: s.wallet, at: s.at.getTime(), ipHash: s.ipHash, ...(s.network ? { network: s.network } : {}) })) };
  }
}
