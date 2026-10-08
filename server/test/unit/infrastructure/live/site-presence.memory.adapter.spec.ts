import { MemorySitePresenceAdapter } from '../../../../src/infrastructure/live/site-presence.memory.adapter.js';

describe('MemorySitePresenceAdapter', () => {
  const T = 1_000_000_000_000, at = (ms: number) => new Date(T + ms);

  it('leave(): a closing page stops counting at once and frees its address slot', () => {
    const p = new MemorySitePresenceAdapter();
    p.seen('ip1', 'a', 'lobby', 'W1', at(0)); p.seen('ip1', 'b', 'landing', null, at(0));
    p.leave('ip1', 'a');
    expect(p.snapshot(at(1)).visitors).toBe(1); expect(p.snapshot(at(1)).wallets.size).toBe(0);
    p.leave('ip9', 'nobody');   // unknown: nothing happens
    expect(p.snapshot(at(1)).visitors).toBe(1);
    p.seen('ip1', 'c', 'lobby', null, at(2)); p.seen('ip1', 'd', 'lobby', null, at(2)); p.seen('ip1', 'e', 'lobby', null, at(2));
    expect(p.snapshot(at(3)).visitors).toBe(3);   // a's slot was freed: b, c, d count (3 per address), e does not
  });

  it('distinct visitors within 30 s, ≤ 3 ids per address, signed-in wallets among them; a visitor who stops polling drops out', () => {
    const p = new MemorySitePresenceAdapter();
    p.seen('ip1', 'a', 'landing', null, at(0));
    p.seen('ip1', 'a', 'lobby', 'W1', at(1000));   // the same visitor moved to the lobby and signed in
    p.seen('ip2', 'b', 'lobby', 'W2', at(2000));
    for (let i = 0; i < 10; i++) p.seen('bot', `id${i}`, 'landing', null, at(3000));
    expect(p.snapshot(at(3000))).toEqual({ visitors: 5, wallets: new Set(['W1', 'W2']) });
    expect(p.snapshot(at(31_500)).visitors).toBe(4);   // a (last seen at 1 s) expired – b and the bots are still in
    expect(p.snapshot(at(40_000))).toEqual({ visitors: 0, wallets: new Set() });
    p.seen('bot', 'new', 'landing', null, at(40_000));   // the bot's slots were freed by the expiry
    expect(p.snapshot(at(40_000)).visitors).toBe(1);
  });
});
