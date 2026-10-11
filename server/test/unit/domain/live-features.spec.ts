import { liveFeatures, refusalFor, type LiveFlags } from '../../../src/domain/live/live-features.js';
import { withoutMuted, type RideEventDto } from '../../../src/domain/live/live.dto.js';

describe('live features (LIVE_* flags resolved per ride)', () => {
  const flags = (o: Partial<LiveFlags> = {}): LiveFlags => ({ chat: 'all', donations: true, freeDonations: true, effects: 'all', ...o });
  const free = { isFree: true }, paid = { isFree: false };

  it('all / off per paid ride; free rides have all features disabled; no donations = no effects; free donations off = paid on chain', () => {
    expect(liveFeatures(flags(), paid)).toEqual({ chat: true, donations: true, payment: 'mock', effects: true });
    expect(liveFeatures(flags(), free)).toEqual({ chat: false, donations: false, payment: 'mock', effects: false });
    expect(liveFeatures(flags({ chat: 'free', effects: 'free' }), paid)).toMatchObject({ chat: false, effects: false });
    expect(liveFeatures(flags({ chat: 'off', effects: 'off' }), paid)).toMatchObject({ chat: false, effects: false });
    expect(liveFeatures(flags({ donations: false }), paid)).toEqual({ chat: true, donations: false, payment: 'mock', effects: false });
    expect(liveFeatures(flags({ freeDonations: false }), paid).payment).toBe('chain');
  });

  it('refusalFor names what is off, and lets a tip through when only effects are off', () => {
    const f = liveFeatures(flags({ chat: 'off', effects: 'off' }), paid);
    expect(refusalFor(f, { kind: 'message' })).toBe('chat is off on this ride');
    expect(refusalFor(f, { kind: 'donation', effect: 'sinkhole' })).toMatch(/effects are off/);
    expect(refusalFor(f, { kind: 'donation', effect: 'tip' })).toBeNull();
    expect(refusalFor(liveFeatures(flags({ donations: false }), paid), { kind: 'donation', effect: 'tip' })).toBe('donations are off');
  });

  it('withoutMuted: a muted wallet\'s lines vanish and its notes blank; everyone else is untouched', () => {
    const e = (id: number, kind: 'message' | 'donation', wallet: string, text: string | null): RideEventDto => ({ id, kind, wallet, text, effect: kind === 'donation' ? 'sinkhole' : null, lamports: 0, at: 0, applied: null, signature: null });
    const feed = [e(1, 'message', 'troll', 'boo'), e(2, 'donation', 'troll', 'note'), e(3, 'message', 'fan', 'hi')];
    expect(withoutMuted(feed, new Set())).toBe(feed);
    expect(withoutMuted(feed, new Set(['troll'])).map((x) => [x.id, x.text])).toEqual([[2, null], [3, 'hi']]);
  });
});
