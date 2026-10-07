import { GetLivenessHandler } from '../../../../../src/application/use-cases/health/get-liveness/get-liveness.handler.js';

describe('GetLivenessHandler', () => {
  it('ok, without any I/O', async () => {
    expect(await new GetLivenessHandler().execute()).toEqual({ status: 'ok' });
  });
});
