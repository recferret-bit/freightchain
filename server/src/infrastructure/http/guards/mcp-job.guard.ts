import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { EditorJobRepositoryPort } from '../../../application/ports/editor/editor-job.repository.port.js';
import { JobTokenPort, type JobClaims } from '../../../application/ports/editor/job-token.port.js';
import { NotFoundError } from '../../../domain/shared/errors.js';
import { EnvService } from '../../config/env.service.js';
import type { RequestWithPlayer } from '../types/http-request.js';

export const JOB_HEADER = 'x-fc-job';
export type RequestWithJob = RequestWithPlayer & { job: JobClaims };

/**
 * The MCP's callbacks (/api/editor/mcp/*): a valid job token (`x-fc-job`, aud mcp-job), the job still RUNNING, its wallet still in EDITOR_WALLETS – and
 * the request must come from the internal network, not through nginx (nginx always sets X-Forwarded-For / X-Real-IP; the MCP container never does).
 * Every refusal is a 404. Puts the claims on the request (@CurrentJob()) and the wallet as the player.
 */
@Injectable()
export class McpJobGuard implements CanActivate {
  constructor(
    private readonly tokens: JobTokenPort,
    private readonly jobs: EditorJobRepositoryPort,
    private readonly env: EnvService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithJob>();
    if (request.headers['x-forwarded-for'] !== undefined || request.headers['x-real-ip'] !== undefined) throw new NotFoundError('not found');
    const raw = request.headers[JOB_HEADER];
    const claims = typeof raw === 'string' && raw ? await this.tokens.verify(raw) : null;
    if (!claims || !this.env.editorWallets.has(claims.wallet)) throw new NotFoundError('not found');
    const job = await this.jobs.find(claims.jobId);
    if (!job || job.status !== 'running' || job.wallet !== claims.wallet || (job.entityId ?? null) !== (claims.entityId ?? null)) throw new NotFoundError('not found');
    request.job = claims;
    request.player = { wallet: claims.wallet };
    return true;
  }
}
