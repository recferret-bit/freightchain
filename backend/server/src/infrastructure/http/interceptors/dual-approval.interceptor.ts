import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { from, mergeMap, throwError, type Observable } from 'rxjs';
import { AdminApprovalService } from '../../../application/services/admin-approval.service.js';
import { needsDualApproval } from '../../../domain/admin/dual-approval.js';
import { PendingApprovalError } from '../../../domain/shared/errors.js';
import { apiPath } from '../api-path.js';
import type { RequestWithPlayer } from '../types/http-request.js';

/** In dual mode a money change is stored and not applied until a different admin approves it. */
@Injectable()
export class DualApprovalInterceptor implements NestInterceptor {
  constructor(private readonly approval: AdminApprovalService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.approval.dual()) return next.handle();
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    const path = apiPath(request.path || request.url || '/');
    if (path.startsWith('/api/admin/proposals/')) return next.handle();
    if (!needsDualApproval(request.method, path, request.body)) return next.handle();
    const wallet = request.player?.wallet;
    if (!wallet) return next.handle();
    const body = (request.body ?? {}) as Record<string, unknown>;
    return from(this.approval.open(path, path, wallet, { path, body }, null)).pipe(mergeMap((id) => throwError(() => new PendingApprovalError(id))));
  }
}
