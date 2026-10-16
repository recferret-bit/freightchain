import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { JobClaims } from '../../../application/ports/editor/job-token.port.js';
import type { RequestWithJob } from '../guards/mcp-job.guard.js';

/** The AI editor job a MCP callback acts for (set by McpJobGuard). */
export const CurrentJob = createParamDecorator((_data: unknown, ctx: ExecutionContext): JobClaims => ctx.switchToHttp().getRequest<RequestWithJob>().job);
