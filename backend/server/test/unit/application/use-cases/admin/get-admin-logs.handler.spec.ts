import { FakeClock } from '../../../../support/fake-clock.js';
import { GetAdminLogsHandler } from '../../../../../src/application/use-cases/admin/get-admin-logs/get-admin-logs.handler.js';
import { GetAdminLogsQuery } from '../../../../../src/application/use-cases/admin/get-admin-logs/get-admin-logs.query.js';
import { LogRing } from '../../../../../src/infrastructure/logging/log-ring.js';
import { RingLogBufferAdapter } from '../../../../../src/infrastructure/logging/ring-log-buffer.adapter.js';

describe('GetAdminLogsHandler', () => {
  it('returns the newest matching lines of this process', async () => {
    const clock = new FakeClock(), ring = new LogRing(clock, 10);
    ring.push({ time: new Date(clock.ms - 1).toISOString(), level: 'log', context: 'HTTP', msg: 'GET /api/pool 200', requestId: 'req-a' });
    ring.push({ time: clock.now().toISOString(), level: 'error', context: 'HTTP', msg: 'POST /api/rides/x/end 500', requestId: 'req-b' });
    const h = new GetAdminLogsHandler(new RingLogBufferAdapter(ring, clock));
    expect((await h.execute(new GetAdminLogsQuery({ limit: 10 }))).entries.map((e) => e.requestId)).toEqual(['req-b', 'req-a']);
    expect((await h.execute(new GetAdminLogsQuery({ limit: 10, minLevel: 'error' }))).entries.map((e) => e.requestId)).toEqual(['req-b']);
    expect((await h.execute(new GetAdminLogsQuery({ limit: 10, text: 'req-a' }))).entries).toHaveLength(1);
  });
});
