import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* The chain context's public routes through the REAL app (the pool program is the FakePoolChain). No gas sponsor is configured here (FEE_PAYER_SECRET → sponsorEnabled
   is covered by the rules-config and handler specs). */
export const CHAIN_ENV = {};

export function chainScenarios(h: () => Harness): void {
  const { anon } = bindClient(h);
  beforeEach(() => h().reset());

  it('GET /api/chain/fees: public, the live purchase quote, who pays it, the blockhash lifetime', async () => {
    h().poolChain.quote = { priorityMicrolamports: 7_500, computeUnits: 30_000, estimatedFeeLamports: 10_225 };
    const res = await anon().get('/api/chain/fees').expect(200);
    expect(res.body).toEqual({ priorityMicrolamports: 7_500, computeUnits: 30_000, estimatedFeeLamports: 10_225, sponsored: false, blockhashTtlSeconds: 60 });
    expect((await anon().get('/api/chain/fees?poolId=3').expect(200)).body.priorityMicrolamports).toBe(7_500);
    expect(h().poolChain.feeQuotes).toEqual([{ poolId: null, kind: 'buy' }, { poolId: 3, kind: 'buy' }]);
  });

  it('a malformed poolId is a 400 problem naming the field', async () => {
    const res = await anon().get('/api/chain/fees?poolId=abc').expect(400);
    expect(res.body).toMatchObject({ code: 'validation_error', detail: 'poolId must be a pool id', errors: [{ path: 'poolId' }] });
  });

  it('POST /api/chain/webhook without WEBHOOK_SECRET configured: 404, whatever secret is sent', async () => {
    const res = await anon().post('/api/chain/webhook').set('x-webhook-secret', 'anything-anything-anything').send([]).expect(404);
    expect(res.body).toMatchObject({ status: 404, code: 'not_found' });
  });

  it('the RPC down is a 503 problem, not a 500', async () => {
    h().poolChain.rpcDown = true;
    const res = await anon().get('/api/chain/fees').expect(503);
    expect(res.body).toMatchObject({ status: 503, code: 'service_unavailable', detail: 'Solana RPC unavailable' });
  });
}
