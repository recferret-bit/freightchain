import { HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ZodError, ZodIssueCode } from 'zod';
import { ConflictError, TermsRequiredError, ServiceUnavailableError } from '../../../../../src/domain/shared/errors.js';
import { ActionErrorFilter, actionError } from '../../../../../src/infrastructure/http/filters/action-error.filter.js';

describe('ActionErrorFilter', () => {
  it('maps the blink refusals onto { message } and keeps the status', () => {
    expect(actionError(new ConflictError('accept the offer', 'agreements_required'))).toEqual({ status: 409, message: 'Accept the 18+ and loss terms on the Freight Chain site, then press this again. Nothing was charged. Devnet SOL only.' });
    expect(actionError(new TermsRequiredError())).toMatchObject({ status: 428, message: expect.stringMatching(/current terms and privacy/) });
    expect(actionError(new ServiceUnavailableError('ticket sales are not configured on this server (no pool program)')).message).toMatch(/not on this server yet/);
    expect(actionError(new ServiceUnavailableError('rpc down')).message).toMatch(/not reachable/);
    expect(actionError(new ConflictError('this pool is not selling tickets right now', 'not_sellable')).message).toMatch(/not selling/);
    expect(actionError(new ZodError([{ code: ZodIssueCode.custom, path: ['account'], message: 'bad' }]))).toMatchObject({ status: 400 });
    expect(actionError(new ZodError([{ code: ZodIssueCode.custom, path: ['account'], message: 'bad' }])).message).toMatch(/Solana account/);
    expect(actionError(new ZodError([{ code: ZodIssueCode.custom, path: ['tier'], message: 'bad' }])).message).toMatch(/Unknown shift/);
    expect(actionError(new ZodError([{ code: ZodIssueCode.custom, path: ['to'], message: 'bad' }])).message).toMatch(/not valid/);
    expect(actionError(new Error('boom'))).toEqual({ status: 500, message: 'Something went wrong. Nothing was charged.' });
    expect(actionError(new HttpException('no', 400)).status).toBe(400);
  });

  it('writes application/json, not problem+json', () => {
    const sent: { status?: number; body?: string; headers: Record<string, string> } = { headers: {} };
    const host = { switchToHttp: () => ({ getRequest: () => ({ originalUrl: '/api/actions/shift' }), getResponse: () => ({ headersSent: false, setHeader: (k: string, v: string) => { sent.headers[k] = v; }, status: (n: number) => { sent.status = n; return { send: (b: string) => { sent.body = b; } }; }, end: () => undefined }) }) } as unknown as ArgumentsHost;
    new ActionErrorFilter().catch(new ConflictError('accept', 'agreements_required'), host);
    expect(sent.status).toBe(409);
    expect(sent.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(sent.body ?? '{}')).toEqual({ message: expect.stringMatching(/18\+/) });
  });
});
