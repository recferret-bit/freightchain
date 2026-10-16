import { CLIENT_ERROR_SURFACES, prepareClientError } from '../../../../src/domain/analytics/client-error.js';

const report = (surface: string) => prepareClientError({ surface, release: null, name: 'TypeError', value: 'x', frames: [] });

describe('client error surfaces', () => {
  it('every page is a crash surface, and an unknown name is dropped', () => {
    expect(CLIENT_ERROR_SURFACES).toEqual(['landing', 'whitepaper', 'pitchdeck', 'lobby', 'game', 'admin', 'blink', 'receipt', 'viewer']);
    for (const surface of CLIENT_ERROR_SURFACES) expect(report(surface)?.surface).toBe(surface);
    expect(report('nope')).toBeNull();
  });
});
