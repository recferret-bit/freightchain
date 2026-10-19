import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { DomainError, ServiceUnavailableError } from '../../../domain/shared/errors.js';

const AGREE = 'Accept the 18+ and loss terms on the Freight Chain site, then press this again. Nothing was charged. Devnet SOL only.';
const UNSOLD = 'Ticket sales are not on this server yet. Nothing was charged. Devnet only.';
const ACCOUNT = 'Send the buyer’s Solana account (base58).';
const FAILED = 'Something went wrong. Nothing was charged.';
const INVALID = 'This action link is not valid. Nothing was charged.';
/** The first bad field names the refusal: a wrong tier in a shared link is not a missing account. */
const FIELD: Record<string, string> = { account: ACCOUNT, tier: 'Unknown shift. A ticket is 1h, 4h or 8h. Nothing was charged.', to: INVALID, id: 'Ride not found' };

/** Blink clients read `{ message }`, not problem+json. Status stays the domain status. */
export function actionError(exception: unknown): { status: number; message: string } {
  if (exception instanceof ZodError) return { status: 400, message: FIELD[String(exception.issues[0]?.path[0] ?? '')] ?? INVALID };
  if (exception instanceof DomainError) {
    if (exception.errorCode === 'agreements_required') return { status: exception.statusCode, message: AGREE };
    if (exception instanceof ServiceUnavailableError) return { status: exception.statusCode, message: /not configured|no pool program/i.test(exception.message) ? UNSOLD : 'The chain is not reachable. Nothing was charged. Devnet only.' };
    return { status: exception.statusCode, message: exception.message };
  }
  if (exception instanceof ThrottlerException) return { status: 429, message: 'Too many requests. Nothing was charged.' };
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return { status: 500, message: FAILED };
    if (status === 400) return { status: 400, message: ACCOUNT };
    return { status, message: exception.message || FAILED };
  }
  if (exception instanceof SyntaxError) return { status: 400, message: ACCOUNT };
  return { status: 500, message: FAILED };
}

@Catch()
export class ActionErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ActionErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    if (response.headersSent) { response.end(); return; }
    const body = actionError(exception);
    if (body.status >= 500) {
      const stack = exception instanceof Error && exception.stack ? `\n${exception.stack}` : '';
      this.logger.error(`action_error path=${request.originalUrl}${stack}`);
    }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.status(body.status).send(JSON.stringify({ message: body.message }));
  }
}
