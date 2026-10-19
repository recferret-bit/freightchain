import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { TooManyRequestsError } from '../../../domain/shared/errors.js';
import { getRequestId } from '../types/http-request.js';
import { toProblem } from './problem-mapping.js';
import { apiPath } from '../api-path.js';

/** THE error renderer: every error of the API leaves as application/problem+json (RFC 9457), with the request id. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetailsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const problem = toProblem(exception, { requestId: getRequestId(request), instance: request.originalUrl });

    if (problem.code === 'internal_error') {
      const stack = exception instanceof Error && exception.stack ? `\n${exception.stack}` : '';
      this.logger.error(`internal_error requestId=${problem.requestId} method=${request.method} path=${request.originalUrl}${stack}`);
    }
    if (response.headersSent) {
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
    if (exception instanceof TooManyRequestsError && exception.retryAfterSeconds !== undefined) response.setHeader('Retry-After', String(Math.max(1, Math.ceil(exception.retryAfterSeconds))));
    if (exception instanceof ThrottlerException) {
      const waits = Object.entries(response.getHeaders()).filter(([name]) => /^retry-after(?:-|$)/i.test(name)).map(([, value]) => Number(value)).filter(Number.isFinite);
      if (waits.length) response.setHeader('Retry-After', String(Math.max(1, ...waits)));
    }
    const path = request.path || request.originalUrl || '';
    // Solana Pay wallets display `message`. Every other route stays the problem object alone.
    const body = apiPath(path).startsWith('/api/solana-pay') ? { ...problem, message: problem.detail ?? problem.title } : problem;
    response.status(problem.status).send(JSON.stringify(body));
  }
}
