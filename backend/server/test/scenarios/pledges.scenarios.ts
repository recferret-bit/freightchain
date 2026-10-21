import { CommandBus } from '@nestjs/cqrs';
import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { RideRepositoryPort } from '../../src/application/ports/rides/ride.repository.port.js';
import { RideBatchRepositoryPort } from '../../src/application/ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../../src/application/ports/verdict/ride-verdict.repository.port.js';
import { PayPoolsCommand } from '../../src/application/use-cases/chain/pay-pools/pay-pools.command.js';
import { SyncPledgesCommand, type PledgeSyncDto } from '../../src/application/use-cases/pledges/sync-pledges/sync-pledges.command.js';
import { Ride } from '../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../src/domain/rides/ride-status.js';
import { RideBatch } from '../../src/domain/telemetry/ride-batch.entity.js';
import { RideVerdict } from '../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../src/domain/verdict/verdict.dto.js';
import { bindClient } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { aPool, chainPool } from '../support/pools.js';
import { aPromo, ticketEffect } from '../support/promos.js';
import { hashBatch } from '../support/recording.js';

/* A spectator pledges per km to a ticket ride over HTTP. The money only moves on chain (the fake pool program here): the sponsor's wallet sends create_pledge,
   POST /confirm reads that transaction's events, the pledge job attests THE RIDE (program v4 – public for the review lock) and settles it with the payout key once the lock is over. */
export const PLEDGES_ENV = { FREE_RIDE_SECONDS: '10' };
const KEY = 'Payout11111111111111111111111111111111111111';
const DAY = 86_400;

export function pledgeScenarios(h: () => Harness): void {
  const { anon, login, sec, now } = bindClient(h);
  beforeEach(() => h().reset());
  const get = <T>(port: abstract new (...a: never[]) => T) => h().app.get(port as never, { strict: false }) as T;
  const bus = () => h().app.get(CommandBus);

  it('pledge → sign → confirm → active; the pool reviewed and paid → the driver is attested before the close → the pledge job settles it on chain', async () => {
    const driver = await login();
    sec(3 * DAY); // an old wallet: a brand-new one in the top 3 would go under review first
    const playDeadline = new Date(now() + 90 * 60_000), payoutAt = playDeadline, prepDeadline = new Date(now() + 30 * 60_000); // last start is 15 min ahead; sales still open
    await get(PoolRepositoryPort).upsert(aPool({ id: 1, status: 'active', ticketsSold: 2, minTickets: 2, payoutAt, playDeadline, prepDeadline }, new Date(now())));
    h().poolChain.pools.set(1, chainPool(new Date(now()), { poolId: 1, status: 'active', ticketsSold: 2, minTickets: 2, vaultLamports: 890_880 + 100_000_000, escrowLamports: 100_000_000, playDeadline, payoutAt, prepDeadline }));
    await get(PromoRepositoryPort).insert(aPromo(new Date(now()), { code: 'ONE', maxRedemptions: null, effect: ticketEffect({ credits: 1 }) }));
    await driver.agent.post('/api/promo/redeem').send({ code: 'ONE' }).expect(200);
    const ride = (await driver.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    await driver.agent.post(`/api/rides/${ride.id}/start`).expect(200);

    const sponsor = await login();
    await anon().post('/api/pledges').send({ rideId: ride.id, lamportsPerKm: '1000000', targetKm: 10 }).expect(401);
    await driver.agent.post('/api/pledges').send({ rideId: ride.id, lamportsPerKm: '1000000', targetKm: 10 }).expect(400); // the driver can't sponsor itself
    const created = (await sponsor.agent.post('/api/pledges').send({ rideId: ride.id, lamportsPerKm: '1000000', targetKm: 10 }).expect(200)).body;
    expect(created.pledge).toMatchObject({ rideId: ride.id, sponsor: sponsor.address, driver: driver.address, status: 'pending', maxLamports: '10000000' });
    expect(created.transaction).toMatchObject({ feePayer: sponsor.address, transaction: expect.any(String) });

    // the sponsor's wallet signs AND sends it: the program creates the Pledge account and emits PledgeCreated
    const sig = h().poolChain.addPledgeTransaction([{ kind: 'PledgeCreated', rideId: ride.id, sponsor: sponsor.address, driver: driver.address, pool: 'pool1', maxLamports: 10_000_000n, lamportsPerKm: 1_000_000n, targetKm: 10 }]);
    const missing = await driver.agent.post('/api/pledges/missing-pledge/confirm').send({ signature: sig }).expect(404);
    const foreign = await driver.agent.post(`/api/pledges/${created.pledge.id}/confirm`).send({ signature: sig }).expect(404);
    expect(foreign.body).toMatchObject({ status: 404, code: missing.body.code, detail: missing.body.detail });
    expect((await sponsor.agent.post(`/api/pledges/${created.pledge.id}/confirm`).send({ signature: sig }).expect(200)).body).toMatchObject({ status: 'active', createSignature: sig });
    expect((await anon().get(`/api/rides/${ride.id}/pledges`).expect(200)).body).toEqual([expect.objectContaining({ id: created.pledge.id, status: 'active', settled: false })]);
    await anon().post(`/api/pledges/${created.pledge.id}/settle`).send({}).expect(404); // no settle route: only the chain settles

    // the driver finishes 7.3 km and the ride is verified (its recording on file)
    const rides = get(RideRepositoryPort);
    const row = (await rides.findById(ride.id))!;
    await rides.save(Ride.restore({ ...row.snapshot(), status: RideStatus.Completed, lastS: 7_300, endedAt: new Date(now()) }));
    const raw = { seq: 0, prevHash: ride.id, t0: 0, t1: 10, samples: [[0, 0, 0, 30, 0, 800, 1, 100, 0, 0, 0, 0]], inputs: [] };
    await get(RideBatchRepositoryPort).insert(RideBatch.accept(ride.id, { ...raw, hash: hashBatch(raw) }, hashBatch(raw), new Date(now())));
    await get(RideVerdictRepositoryPort).save(RideVerdict.restore({ rideId: ride.id, status: VerdictStatus.Verified, reasons: [], scores: {} as never, rulesVersion: 4, judgedAt: new Date(now()), version: 1 }));

    // still in the play window: the pledge job attests the RIDE at once (program v4: rewritable until a pledge settles on it) – but nothing pays or ends the pledge
    h().payoutChain.payoutAddress = KEY;
    h().payoutChain.now = new Date(now());
    await bus().execute(new PayPoolsCommand());
    expect(await bus().execute(new SyncPledgesCommand())).toMatchObject({ settled: 0, refunded: 0 });
    expect(h().payoutChain.calls).toEqual([`attest 1 ${ride.id} 1`]);
    expect(h().payoutChain.attestations.get(`1:${ride.id}`)?.settleFrom).toEqual(payoutAt); // its pledges settle only after the review lock

    // the review window is over: the payout pass pays the winner, attests the pledged driver, closes; the pledge job settles
    sec(2 * 3_600);
    h().payoutChain.now = new Date(now());
    const pass = await bus().execute(new PayPoolsCommand());
    expect(pass.pools[0]).toMatchObject({ poolId: 1, state: 'paid' });
    expect(h().payoutChain.calls).toEqual([`attest 1 ${ride.id} 1`, 'commit 1 1', 'prize 1 1', 'close 1']); // the ride's attestation stands (same facts): commit → pay → close
    const sync = (await bus().execute(new SyncPledgesCommand())) as PledgeSyncDto;
    expect(sync).toMatchObject({ sending: true, settled: 1, errors: [] });
    expect(h().payoutChain.attestations.get(`1:${ride.id}`)).toMatchObject({ status: 1, verifiedKm: 7 });
    expect((await anon().get(`/api/pledges/${created.pledge.id}`).expect(200)).body).toMatchObject({
      status: 'settled', settled: true, earnedLamports: '7000000', refundedLamports: '3000000', signature: expect.any(String),
    });
  });

  it('a pledge nobody signed stays pending and costs nothing; a pledge to a driver who never finishes is refunded once the pool is over', async () => {
    const driver = await login();
    const playDeadline = new Date(now() + 90 * 60_000), payoutAt = playDeadline, prepDeadline = new Date(now() + 30 * 60_000);
    await get(PoolRepositoryPort).upsert(aPool({ id: 1, status: 'active', payoutAt, playDeadline, prepDeadline }, new Date(now())));
    h().poolChain.pools.set(1, chainPool(new Date(now()), { poolId: 1, status: 'active', playDeadline, payoutAt, prepDeadline }));
    await get(PromoRepositoryPort).insert(aPromo(new Date(now()), { code: 'ONE', maxRedemptions: null, effect: ticketEffect({ credits: 1 }) }));
    await driver.agent.post('/api/promo/redeem').send({ code: 'ONE' }).expect(200);
    const ride = (await driver.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    const sponsor = await login();
    const p = (await sponsor.agent.post('/api/pledges').send({ rideId: ride.id, lamportsPerKm: '2000', targetKm: 5 }).expect(200)).body.pledge;
    expect((await sponsor.agent.post(`/api/pledges/${p.id}/confirm`).send({ signature: '5'.repeat(88) }).expect(200)).body.status).toBe('pending'); // not on chain
    h().poolChain.addPledgeTransaction([{ kind: 'PledgeCreated', rideId: ride.id, sponsor: sponsor.address, driver: driver.address, pool: 'pool1', maxLamports: 10_000n, lamportsPerKm: 2_000n, targetKm: 5 }]);
    h().payoutChain.payoutAddress = KEY;
    expect(await bus().execute(new SyncPledgesCommand())).toMatchObject({ activated: 1, refunded: 0 }); // found on chain without a confirm
    // the pool fails its goal → refunding: no attestation for this driver → refund_pledge
    h().poolChain.pools.set(1, { ...h().poolChain.pools.get(1)!, status: 'refunding' });
    await get(PoolRepositoryPort).upsert(aPool({ id: 1, status: 'refunding', payoutAt, playDeadline: payoutAt, prepDeadline }, new Date(now())));
    expect(await bus().execute(new SyncPledgesCommand())).toMatchObject({ refunded: 1 });
    expect((await anon().get(`/api/pledges/${p.id}`).expect(200)).body).toMatchObject({ status: 'refunded', earnedLamports: '0', refundedLamports: '10000' });
  });
}
