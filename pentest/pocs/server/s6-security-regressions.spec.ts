import { EventEmitter } from 'node:events';
import type { CommandBus } from '@nestjs/cqrs';
import type { ExecutionContext } from '@nestjs/common';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Connection } from '@solana/web3.js';
import { TokenSignerPort } from '../../../src/application/ports/auth/token-signer.port.js';
import { RequestChallengeHandler } from '../../../src/application/use-cases/auth/request-challenge/request-challenge.handler.js';
import { RequestChallengeCommand } from '../../../src/application/use-cases/auth/request-challenge/request-challenge.command.js';
import { SweepSignInsCommand } from '../../../src/application/use-cases/auth/sweep-sign-ins/sweep-sign-ins.command.js';
import { SweepSignInsHandler } from '../../../src/application/use-cases/auth/sweep-sign-ins/sweep-sign-ins.handler.js';
import { SweepTelemetryCommand } from '../../../src/application/use-cases/telemetry/sweep-telemetry/sweep-telemetry.command.js';
import { SweepTelemetryHandler } from '../../../src/application/use-cases/telemetry/sweep-telemetry/sweep-telemetry.handler.js';
import { MemoryCacheAdapter } from '../../../src/infrastructure/cache/memory-cache.adapter.js';
import type { EnvService } from '../../../src/infrastructure/config/env.service.js';
import { requestLogMiddleware } from '../../../src/infrastructure/http/middleware/request-log.middleware.js';
import { throttlerOptions } from '../../../src/infrastructure/http/throttling.js';
import { JsonLogger } from '../../../src/infrastructure/logging/json-logger.js';
import { LogRing } from '../../../src/infrastructure/logging/log-ring.js';
import { TelemetryRetentionScheduler } from '../../../src/infrastructure/scheduling/telemetry-retention.scheduler.js';
import { SnsNameServiceAdapter } from '../../../src/infrastructure/sns/sns-name-service.adapter.js';
import { SolanaRpc } from '../../../src/infrastructure/solana/solana-rpc.js';
import { FakeClock } from '../../support/fake-clock.js';
import { unitContext } from '../../support/unit-context.js';

/** Deliberately red security invariants; no HTTP listener, real database, RPC or signing keys are used. */
class NoTokens extends TokenSignerPort {
  async sign() { return { token: 'unused-test-token', expiresAt: new Date(0) }; }
  async verify() { return null; }
}

type Budget = { name: string; skipIf: (context: ExecutionContext) => boolean };
const at = (path: string) => ({ switchToHttp: () => ({ getRequest: () => ({ path }) }) }) as unknown as ExecutionContext;
const budgets = () => throttlerOptions({ throttleLimit: 600, throttleAuthLimit: 30, throttlePromoLimit: 30 } as EnvService, new NoTokens()) as Budget[];

/** Exercise the installed Express matcher's defaults, without sending a request. */
const routeMatches = (canonical: string, candidate: string) => {
  const router = Router();
  router.post(canonical, (_req, _res, next) => next());
  const layer = (router as unknown as { stack: { match: (path: string) => boolean }[] }).stack[0]!;
  return layer.match(candidate);
};

describe('S6: route classification must agree with the installed router', () => {
  it('keeps the auth-specific budget for a case-equivalent route', () => {
    const canonical = '/api/auth/nonce', equivalent = canonical.replace('auth', 'AUTH');
    expect(routeMatches(canonical, equivalent)).toBe(true);
    const auth = budgets().find((b) => b.name === 'auth')!;
    expect(auth.skipIf(at(canonical))).toBe(false);
    expect(auth.skipIf(at(equivalent))).toBe(false);
  });

  it.each(['trailing slash', 'case'])('keeps the per-IP promo budget for an equivalent path (%s)', (kind) => {
    const canonical = '/api/promo/redeem';
    const equivalent = kind === 'case' ? canonical.replace('redeem', 'REDEEM') : `${canonical}/`;
    expect(routeMatches(canonical, equivalent)).toBe(true);
    const promo = budgets().find((b) => b.name === 'promo')!;
    expect(promo.skipIf(at(canonical))).toBe(false);
    expect(promo.skipIf(at(equivalent))).toBe(false);
  });

  it('records a request line for every case-equivalent API path', () => {
    const canonical = '/api/auth/nonce', path = canonical.replace('api', 'API');
    expect(routeMatches(canonical, path)).toBe(true);
    const ring = new LogRing(10), clock = new FakeClock();
    const logger = new JsonLogger(clock, ring, { isProduction: true } as EnvService, () => undefined);
    const req = { path, method: 'POST', ip: '192.0.2.1', requestId: 's6-regression' } as unknown as Request;
    const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    requestLogMiddleware(logger)(req, res, next);
    (res as unknown as EventEmitter).emit('finish');
    expect(next).toHaveBeenCalledOnce();
    expect(ring.recent({ limit: 10 })).toHaveLength(1);
  });
});

describe('S6: expired anonymous sign-in challenges must be reclaimed', () => {
  it('removes expired challenges when the scheduled retention job runs', async () => {
    const ctx = unitContext();
    const issue = new RequestChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy);
    const first = await issue.execute(new RequestChallengeCommand());
    ctx.clock.advance(ctx.rules.get().nonceTtlMs / 1000 + 1);
    const second = await issue.execute(new RequestChallengeCommand());
    expect(ctx.db.challenges.size).toBe(2);
    expect(ctx.db.challenges.get(`nonce:${first.nonce}`)!.isExpired(ctx.clock.now())).toBe(true);
    const telemetry = new SweepTelemetryHandler(ctx.batches, ctx.rules, ctx.clock);
    const signIns = new SweepSignInsHandler(ctx.signIns, ctx.rules, ctx.clock);
    const commands = { execute: (command: unknown) => {
      if (command instanceof SweepTelemetryCommand) return telemetry.execute();
      if (command instanceof SweepSignInsCommand) return signIns.execute();
      throw new Error('unexpected scheduled command');
    } } as unknown as CommandBus;
    const scheduler = new TelemetryRetentionScheduler(commands, ctx.clock);
    try {
      await scheduler.run();
    } finally {
      scheduler.onApplicationShutdown();
    }
    expect(ctx.db.challenges.has(`nonce:${second.nonce}`)).toBe(true);
    expect(ctx.db.challenges.has(`nonce:${first.nonce}`)).toBe(false);
  });
});

describe('S6: SNS response deadlines must also bound upstream work', () => {
  it('does not leave an outstanding upstream operation after its response timeout', async () => {
    vi.useFakeTimers();
    const clock = new FakeClock(), cache = new MemoryCacheAdapter(clock);
    let active = 0, settle: (() => void) | undefined;
    const primary = { getAccountInfo: () => {
      active++;
      return new Promise<null>((resolve) => { settle = () => { active--; resolve(null); }; });
    } } as unknown as Connection;
    const rpc = new SolanaRpc(primary);
    const env = { snsCacheTtlSeconds: 86400, snsNegativeCacheTtlSeconds: 1800 } as EnvService;
    const adapter = new SnsNameServiceAdapter(env, cache, rpc);
    try {
      const result = adapter.resolve('s6-deadline-check.sol');
      await vi.advanceTimersByTimeAsync(3000);
      expect(await result).toBeNull();
      expect(active).toBe(0);
    } finally {
      settle?.();
      await Promise.resolve();
      vi.useRealTimers();
    }
  });
});
