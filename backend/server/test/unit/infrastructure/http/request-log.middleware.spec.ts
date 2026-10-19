import { EventEmitter } from 'node:events';
import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestLogMiddleware } from '../../../../src/infrastructure/http/middleware/request-log.middleware.js';

const run = (path: string, status: number, player?: { wallet: string }) => {
  const calls: { level: string; line: Record<string, unknown>; context: unknown }[] = [];
  const logger = {
    log: (line: Record<string, unknown>, context: unknown) => calls.push({ level: 'log', line, context }),
    warn: (line: Record<string, unknown>, context: unknown) => calls.push({ level: 'warn', line, context }),
    error: (line: Record<string, unknown>, context: unknown) => calls.push({ level: 'error', line, context }),
  } as unknown as LoggerService;
  const req = { path, method: 'POST', ip: '1.2.3.4', requestId: 'req-00000001', player } as unknown as Request;
  const res = Object.assign(new EventEmitter(), { statusCode: status }) as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  requestLogMiddleware(logger)(req, res, next);
  (res as unknown as EventEmitter).emit('finish');
  return { calls, next };
};

describe('requestLogMiddleware', () => {
  it('logs an API call when it finishes: method, path, status, duration, request id, the signed-in wallet, ip', () => {
    const { calls, next } = run('/api/rides/r1/end', 200, { wallet: 'W' });
    expect(next).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ level: 'log', context: 'HTTP', line: { event: 'request', msg: 'POST /api/rides/r1/end 200', method: 'POST', path: '/api/rides/r1/end', status: 200, requestId: 'req-00000001', wallet: 'W', ip: '1.2.3.4' } });
    expect(typeof calls[0]?.line['ms']).toBe('number');
  });

  it('4xx is a warning, 5xx an error', () => {
    expect(run('/api/me', 401).calls[0]?.level).toBe('warn');
    expect(run('/api/pool', 503).calls[0]?.level).toBe('error');
  });

  it('static files and health probes are not logged (but still passed on)', () => {
    for (const path of ['/play.html', '/assets/x.js', '/api/health/ready', '/api/health/live']) {
      const { calls, next } = run(path, 200);
      expect(calls, path).toEqual([]);
      expect(next).toHaveBeenCalledOnce();
    }
  });
});
