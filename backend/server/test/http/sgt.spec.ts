import { createHarness, type Harness } from '../support/harness.js';
import { bindClient } from '../support/client.js';
describe('SGT unconfigured', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness('memory'); });
  afterAll(() => h.close());
  it('boots with a truthful unavailable status and refuses a claim', async () => {
    const rider = await bindClient(() => h).login();
    expect((await rider.agent.get('/api/me/trust/sgt').expect(200)).body).toMatchObject({ enabled: false, claimed: false });
    expect((await rider.agent.post('/api/me/trust/sgt').send({}).expect(503)).body.code).toBe('sgt_unconfigured');
  });
});
