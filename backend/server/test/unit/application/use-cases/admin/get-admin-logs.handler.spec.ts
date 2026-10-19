import { GetAdminLogsHandler } from '../../../../../src/application/use-cases/admin/get-admin-logs/get-admin-logs.handler.js';
import { GetAdminLogsQuery } from '../../../../../src/application/use-cases/admin/get-admin-logs/get-admin-logs.query.js';
import { LogRing } from '../../../../../src/infrastructure/logging/log-ring.js';
import { RingLogBufferAdapter } from '../../../../../src/infrastructure/logging/ring-log-buffer.adapter.js';

describe('GetAdminLogsHandler', () => {
  it('returns the newest matching lines of this process', async () => {
    const ring = new LogRing(10);
    ring.push({ time: 't1', level: 'log', context: 'HTTP', msg: 'GET /api/pool 200', requestId: 'req-a' });
    ring.push({ time: 't2', level: 'error', context: 'HTTP', msg: 'POST /api/rides/x/end 500', requestId: 'req-b' });
    const h = new GetAdminLogsHandler(new RingLogBufferAdapter(ring));
    expect((await h.execute(new GetAdminLogsQuery({ limit: 10 }))).entries.map((e) => e.time)).toEqual(['t2', 't1']);
    expect((await h.execute(new GetAdminLogsQuery({ limit: 10, minLevel: 'error' }))).entries.map((e) => e.requestId)).toEqual(['req-b']);
    expect((await h.execute(new GetAdminLogsQuery({ limit: 10, text: 'req-a' }))).entries).toHaveLength(1);
  });
});
