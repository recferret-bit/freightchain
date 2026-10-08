import { MemoryViewerPresenceAdapter } from '../../../../src/infrastructure/live/viewer-presence.memory.adapter.js';
import { VIEWER_WINDOW_MS } from '../../../../src/domain/live/live-rules.js';

describe('MemoryViewerPresenceAdapter', () => {
  const T = 1_000_000_000_000;
  const at = (ms: number) => new Date(T + ms);

  it('counts distinct viewers per ride within the window; a viewer who stops polling drops out', () => {
    const p = new MemoryViewerPresenceAdapter();
    expect(p.seen('r', 'a', at(0))).toBe(1);
    expect(p.seen('r', 'a', at(1000))).toBe(1);
    expect(p.seen('r', 'b', at(2000))).toBe(2);
    expect(p.seen('other', 'a', at(2000))).toBe(1);
    expect(p.count('r', at(VIEWER_WINDOW_MS + 1500))).toBe(1); // a's last poll (1000) is out of the window, b's (2000) is not
    expect(p.seen('r', 'a', at(VIEWER_WINDOW_MS + 1500))).toBe(2);
    expect(p.count('r', at(10 * VIEWER_WINDOW_MS))).toBe(0);
    expect(p.count('never', at(0))).toBe(0);
  });

  it('memory stays bounded: beyond the ride cap the stalest ride is forgotten', () => {
    const p = new MemoryViewerPresenceAdapter();
    for (let i = 0; i < 2000; i++) p.seen(`r${i}`, 'v', at(i));
    p.seen('fresh', 'v', at(5000));
    expect(p.count('r0', at(5000))).toBe(0);
    expect(p.count('r1', at(5000))).toBe(1);
    expect(p.count('fresh', at(5000))).toBe(1);
  });
});
