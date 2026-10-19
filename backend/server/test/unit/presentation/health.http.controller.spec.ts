import { HealthHttpController } from '../../../src/presentation/health/health.http.controller.js';
import { GetLivenessQuery } from '../../../src/application/use-cases/health/get-liveness/get-liveness.query.js';
import { GetReadinessQuery } from '../../../src/application/use-cases/health/get-readiness/get-readiness.query.js';
import { ServiceUnavailableError } from '../../../src/domain/shared/errors.js';
import { busMock } from '../../support/bus.js';

describe('HealthHttpController', () => {
  it('live → GetLivenessQuery', async () => {
    const queries = busMock({ status: 'ok' });
    expect(await new HealthHttpController(queries.bus).live()).toEqual({ status: 'ok' });
    expect(queries.last()).toBeInstanceOf(GetLivenessQuery);
  });

  it('ready → GetReadinessQuery; a degraded result becomes a 503 with the checks', async () => {
    const up = busMock({ status: 'ok', checks: { database: { status: 'up' } } });
    expect(await new HealthHttpController(up.bus).ready()).toMatchObject({ status: 'ok' });
    expect(up.last()).toBeInstanceOf(GetReadinessQuery);
    const down = busMock({ status: 'degraded', checks: { database: { status: 'down' } } });
    await expect(new HealthHttpController(down.bus).ready()).rejects.toMatchObject(new ServiceUnavailableError('Readiness degraded', { database: { status: 'down' } }));
  });
});
