import { HealthProbePort } from '../../../../../src/application/ports/health/health-probe.port.js';
import { GetReadinessHandler } from '../../../../../src/application/use-cases/health/get-readiness/get-readiness.handler.js';

class Probe extends HealthProbePort {
  constructor(private readonly up: boolean) { super(); }
  async pingDatabase() { if (!this.up) throw new Error('connection refused'); return 4; }
}

describe('GetReadinessHandler', () => {
  it('ok with the database latency when it answers', async () => {
    expect(await new GetReadinessHandler(new Probe(true)).execute()).toEqual({ status: 'ok', checks: { database: { status: 'up', latencyMs: 4 } } });
  });
  it('degraded (never throws) when it does not', async () => {
    expect(await new GetReadinessHandler(new Probe(false)).execute()).toEqual({ status: 'degraded', checks: { database: { status: 'down' } } });
  });
});
