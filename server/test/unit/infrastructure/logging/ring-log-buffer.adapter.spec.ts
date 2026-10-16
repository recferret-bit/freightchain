import { RingLogBufferAdapter } from '../../../../src/infrastructure/logging/ring-log-buffer.adapter.js';
import { LogRing } from '../../../../src/infrastructure/logging/log-ring.js';

describe('RingLogBufferAdapter', () => {
  it('answers the port from the shared ring', async () => {
    const ring = new LogRing(5);
    ring.push({ time: 't', level: 'warn', context: 'X', msg: 'hello' });
    expect(await new RingLogBufferAdapter(ring).recent({ limit: 5, minLevel: 'warn' })).toEqual([{ time: 't', level: 'warn', context: 'X', msg: 'hello' }]);
  });
});
