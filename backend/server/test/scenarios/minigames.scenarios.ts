import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { aPool } from '../support/pools.js';
import { aPromo, ticketEffect } from '../support/promos.js';

/** Shadow mode so a 1h start stamps a commit. The product default remains off. */
export const MINIGAMES_ENV = { MINIGAMES: 'shadow', MG_SECRET: 'k'.repeat(32), MG_SALT_VERSION: 'mg:v1' };
const MAC = 'a'.repeat(43);

export function minigameScenarios(h: () => Harness): void {
  const { login, now, sec } = bindClient(h);
  beforeEach(() => h().reset());

  const start1h = async () => {
    const rider = await login();
    const at = new Date(now());
    await h().app.get(PoolRepositoryPort, { strict: false }).upsert(aPool({ id: 1, status: 'active', ticketsSold: 1, minTickets: 1 }, at));
    await h().app.get(PromoRepositoryPort, { strict: false }).insert(aPromo(at, { code: 'ONE', maxRedemptions: null, effect: ticketEffect({ credits: 1 }) }));
    await rider.agent.post('/api/promo/redeem').send({ code: 'ONE' }).expect(200);
    const ride = (await rider.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body as { id: string };
    const started = (await rider.agent.post(`/api/rides/${ride.id}/start`).send({ mgMode: 'normal', lang: 'en' }).expect(200)).body as { mgCommit: string | null; tier: string };
    return { rider, ride, started };
  };

  it('a free ride stamps a null commit and refuses a minigame', async () => {
    const rider = await login();
    const free = (await rider.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body as { id: string };
    const started = (await rider.agent.post(`/api/rides/${free.id}/start`).expect(200)).body as { mgCommit: string | null };
    expect(started.mgCommit).toBeNull();
    await rider.agent.post(`/api/rides/${free.id}/minigames/${'b'.repeat(16)}/open`).send({ mac: MAC, variantSeq: 0 }).expect(404);
  });

  it('a 1h ride arms phone-sms only, hides the code, and charges +20 after three wrong tries', async () => {
    const { rider, ride, started } = await start1h();
    expect(started.tier).toBe('1h');
    expect(started.mgCommit).toMatch(/^[0-9a-f]{64}$/);
    let t = 0;
    let s = 0;
    let beat: { minigames?: { id: string; kind: string }[]; status?: string; reason?: string | null } = {};
    for (let i = 0; i < 32 && (beat.minigames?.length ?? 0) === 0; i++) {
      sec(120);
      t += 110;
      s += 1500;
      beat = (await rider.agent.post(`/api/rides/${ride.id}/heartbeat`).send({ s, t, hull: 100, paused: false, night: false, crashesVehicle: 0, crashesBuilding: 0 }).expect(200)).body;
      if (beat.status !== 'running') throw new Error(JSON.stringify(beat));
    }
    const events = beat.minigames ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.kind === 'phone-sms')).toBe(true);
    await rider.agent.post(`/api/rides/${ride.id}/minigames/${events[0]!.id}/open`).send({ mac: 'short', variantSeq: 0 }).expect(400);
    const opened = (await rider.agent.post(`/api/rides/${ride.id}/minigames/${events[0]!.id}/open`).send({ mac: MAC, variantSeq: 0, safe: true }).expect(200)).body as { nonce: string; layout: unknown };
    expect(JSON.stringify(opened)).not.toMatch(/"code"/);
    let last: { outcome: string; penaltyS: number } = { outcome: 'pending', penaltyS: 0 };
    for (let attempt = 1; attempt <= 3; attempt++) {
      last = (await rider.agent.post(`/api/rides/${ride.id}/minigames/${events[0]!.id}/answer`).send({ mac: MAC, nonce: opened.nonce, attempt, answer: '12345678' }).expect(200)).body;
    }
    expect(last).toMatchObject({ outcome: 'failed', penaltyS: 20 });
  });
}
