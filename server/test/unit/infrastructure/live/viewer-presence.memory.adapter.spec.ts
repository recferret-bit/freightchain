import { MemoryViewerPresenceAdapter } from '../../../../src/infrastructure/live/viewer-presence.memory.adapter.js';
import { VIEWERS_PER_SOURCE, VIEWER_WINDOW_MS } from '../../../../src/domain/live/live-rules.js';

describe('MemoryViewerPresenceAdapter', () => {
  const T = 1_000_000_000_000;
  const at = (ms: number) => new Date(T + ms);

  it('counts distinct viewers per ride within the window; a viewer who stops polling drops out', () => {
    const p = new MemoryViewerPresenceAdapter();
    expect(p.seen('r', 'ip1', 'a', at(0))).toBe(1);
    expect(p.seen('r', 'ip1', 'a', at(1000))).toBe(1);
    expect(p.seen('r', 'ip2', 'b', at(2000))).toBe(2);
    expect(p.seen('other', 'ip1', 'a', at(2000))).toBe(1);
    expect(p.count('r', at(VIEWER_WINDOW_MS + 1500))).toBe(1); // a's last poll (1000) is out of the window, b's (2000) is not
    expect(p.seen('r', 'ip1', 'a', at(VIEWER_WINDOW_MS + 1500))).toBe(2);
    expect(p.count('r', at(10 * VIEWER_WINDOW_MS))).toBe(0);
    expect(p.count('never', at(0))).toBe(0);
  });

  it('made-up ids cannot inflate the count: at most VIEWERS_PER_SOURCE per address; the slot frees once one expires', () => {
    const p = new MemoryViewerPresenceAdapter();
    for (let i = 0; i < 50; i++) p.seen('r', 'bot', `id-${i}`, at(i));
    expect(p.count('r', at(100))).toBe(VIEWERS_PER_SOURCE);
    expect(p.seen('r', 'person', 'x', at(100))).toBe(VIEWERS_PER_SOURCE + 1);
    expect(p.seen('r', 'bot', 'new', at(VIEWER_WINDOW_MS + 50))).toBe(2); // the bot's first ids expired; person + 'new'
  });

  it('watching(): distinct viewers across every ride – the same viewer on two rides counts once; expired ones drop out', () => {
    const p = new MemoryViewerPresenceAdapter();
    p.seen('r1', 'ip1', 'a', at(0)); p.seen('r2', 'ip1', 'a', at(0)); p.seen('r2', 'ip2', 'b', at(1000));
    expect(p.watching(at(1000))).toBe(2);
    expect(p.watching(at(VIEWER_WINDOW_MS + 500))).toBe(1);
  });

  it('memory stays bounded: rides nobody polls are forgotten, and the stalest beyond the ride cap', () => {
    const p = new MemoryViewerPresenceAdapter();
    for (let i = 0; i < 2000; i++) p.seen(`r${i}`, `ip${i}`, 'v', at(i));
    p.seen('fresh', 'ip', 'v', at(5000));
    expect(p.count('r0', at(5000))).toBe(0);
    expect(p.count('r1', at(5000))).toBe(1);
    p.seen('later', 'ip', 'v', at(VIEWER_WINDOW_MS + 6000)); // everything else went silent
    expect((p as unknown as { rides: Map<string, unknown> }).rides.size).toBe(1);
  });
});
