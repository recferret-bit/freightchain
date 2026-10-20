import request from 'supertest';
import type { Harness } from '../support/harness.js';

/* When COOKIE_DOMAIN is set, storybook.<apex> answers only /api/entities and /api/editor.
   Every other route is 404 there — the as-built host refusal (not 401/403). Paths stay literal so the census sees them. */
export const HOST_GAP_ENV = { COOKIE_DOMAIN: 'freightchain.localhost' };
const SB = 'storybook.freightchain.localhost';

export function hostGapScenarios(h: () => Harness): void {
  beforeEach(() => h().reset());

  it('storybook.<apex> 404s routes that are not the model API', async () => {
    const req = request(h().server());
    await req.get('/actions.json').set('Host', SB).expect(404);
    await req.get('/api/actions/hello').set('Host', SB).expect(404);
    await req.post('/api/actions/hello').set('Host', SB).send({}).expect(404);
    await req.get('/api/actions/shift/1h').set('Host', SB).expect(404);
    await req.post('/api/actions/shift').set('Host', SB).send({}).expect(404);
    await req.post('/api/actions/go/home').set('Host', SB).send({}).expect(404);
    await req.get('/api/actions/ride/missing-ride').set('Host', SB).expect(404);
    await req.post('/api/actions/ride/missing-ride').set('Host', SB).send({}).expect(404);
    await req.post('/api/actions/ride/missing-ride/watch').set('Host', SB).send({}).expect(404);
    await req.get('/api/health/ready').set('Host', SB).expect(404);
    await req.get('/api/honk/catalog').set('Host', SB).expect(404);
    await req.get('/api/honk').set('Host', SB).expect(404);
    await req.get('/api/stats/daily').set('Host', SB).expect(404);
    await req.get('/api/prize/board').set('Host', SB).expect(404);
    await req.get('/api/sns/reverse').set('Host', SB).expect(404);
    await req.get('/api/sns/resolve').set('Host', SB).expect(404);
    await req.get('/api/replays').set('Host', SB).expect(404);
    await req.get('/api/rides/missing-ride/public').set('Host', SB).expect(404);
    await req.get('/api/rides/missing-ride/pledges').set('Host', SB).expect(404);
    await req.post('/api/auth/guest').set('Host', SB).expect(404);
    await req.post('/api/auth/logout').set('Host', SB).expect(404);
    await req.post('/api/auth/pair').set('Host', SB).expect(404);
    await req.get('/api/auth/pair/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').set('Host', SB).expect(404);
    await req.post('/api/auth/pair/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/claim').set('Host', SB).expect(404);
    await req.post('/api/referrals/gift').set('Host', SB).expect(404);
    await req.get('/api/tickets/pending').set('Host', SB).expect(404);
    await req.get('/api/tickets/orders/00000000-0000-4000-8000-000000000001/payment').set('Host', SB).expect(404);
    await req.post('/api/tickets/orders/00000000-0000-4000-8000-000000000001/confirm').set('Host', SB).send({}).expect(404);
    await req.post('/api/tickets/orders/00000000-0000-4000-8000-000000000001/reconcile').set('Host', SB).expect(404);
    await req.get('/api/solana-pay/orders/missing-order').set('Host', SB).expect(404);
    await req.post('/api/solana-pay/orders/missing-order').set('Host', SB).send({}).expect(404);
    await req.get('/api/solana-pay/donations/missing-donation').set('Host', SB).expect(404);
    await req.post('/api/solana-pay/donations/missing-donation').set('Host', SB).send({}).expect(404);
    await req.post('/api/solana-pay/rides/missing-ride').set('Host', SB).send({}).expect(404);
    await req.post('/api/watch/missing-ride/honk').set('Host', SB).send({}).expect(404);
    await req.post('/api/watch/missing-ride/honk/time').set('Host', SB).send({}).expect(404);
    await req.post('/api/watch/missing-ride/honk/weather').set('Host', SB).send({}).expect(404);
    await req.post('/api/watch/missing-ride/donation-orders').set('Host', SB).send({}).expect(404);
    await req.post('/api/watch/missing-ride/donation-orders/00000000-0000-4000-8000-000000000001/confirm').set('Host', SB).send({}).expect(404);
    await req.post('/api/watch/missing-ride/donation-orders/00000000-0000-4000-8000-000000000001/reconcile').set('Host', SB).expect(404);
    await req.post('/api/rides/missing-ride/mutes').set('Host', SB).send({}).expect(404);
    await req.get('/api/pools/1/standings').set('Host', SB).expect(404);
    await req.get('/api/pools/1/refund').set('Host', SB).expect(404);
    await req.get('/api/pools/1/payout').set('Host', SB).expect(404);
    await req.post('/api/chain/settle').set('Host', SB).send({}).expect(404);
    await req.get('/api/admin/queue/count').set('Host', SB).expect(404);
    await req.get('/api/admin/players').set('Host', SB).expect(404);
    await req.get('/api/admin/pools').set('Host', SB).expect(404);
    await req.get('/api/admin/pools/1').set('Host', SB).expect(404);
    await req.get('/api/admin/stats').set('Host', SB).expect(404);
    await req.get('/api/admin/sessions').set('Host', SB).expect(404);
    await req.get('/api/admin/pool-payouts').set('Host', SB).expect(404);
    await req.get('/api/admin/replays').set('Host', SB).expect(404);
    await req.get('/api/admin/logs').set('Host', SB).expect(404);
    await req.post('/api/admin/pools/1/hold/challenge').set('Host', SB).send({}).expect(404);
    await req.post('/api/admin/pools/1/hold').set('Host', SB).send({}).expect(404);
    await req.post('/api/admin/players/free-rides/challenge').set('Host', SB).send({}).expect(404);
    await req.post('/api/admin/rides/missing-ride/rejudge').set('Host', SB).send({}).expect(404);
    await req.post('/api/admin/auth/logout').set('Host', SB).expect(404);
  });

  it('a port on the storybook host is stripped and still 404s the public reads', async () => {
    const req = request(h().server());
    await req.get('/api/honk/catalog').set('Host', `${SB}:443`).expect(404);
    await req.get('/api/health/ready').set('Host', `${SB}:443`).expect(404);
    await req.get('/api/stats/daily').set('Host', `${SB}:443`).expect(404);
    await req.get('/actions.json').set('Host', `${SB}:443`).expect(404);
    await req.get('/api/actions/hello').set('Host', `${SB}:443`).expect(404);
    await req.get('/api/actions/shift/1h').set('Host', `${SB}:443`).expect(404);
    await req.post('/api/auth/guest').set('Host', `${SB}:443`).expect(404);
    await req.get('/api/prize/board').set('Host', `${SB}:443`).expect(404);
    await req.get('/api/sns/reverse').set('Host', `${SB}:443`).expect(404);
    await req.get('/api/sns/resolve').set('Host', `${SB}:443`).expect(404);
  });
}
