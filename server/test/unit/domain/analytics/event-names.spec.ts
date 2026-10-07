import { CLIENT_EVENTS } from '../../../../src/domain/analytics/client-events.js';
import { SERVER_EVENTS } from '../../../../src/domain/analytics/server-events.js';

describe('analytics event names', () => {
  it('client and server names are disjoint', () => {
    const both = CLIENT_EVENTS.filter((name) => (SERVER_EVENTS as readonly string[]).includes(name));
    expect(both).toEqual([]);
    expect(new Set(CLIENT_EVENTS).size).toBe(CLIENT_EVENTS.length);
    expect(new Set(SERVER_EVENTS).size).toBe(SERVER_EVENTS.length);
  });
});
