import { PaymentRepositoryPort } from '../../../../src/application/ports/economy/payment.repository.port.js';
import { RoundRepositoryPort } from '../../../../src/application/ports/economy/round.repository.port.js';
import { PaymentSettlementService } from '../../../../src/application/services/payment-settlement.service.js';
import { Payment } from '../../../../src/domain/economy/payment.entity.js';
import type { Round } from '../../../../src/domain/economy/round.entity.js';
import { RideStatus } from '../../../../src/domain/rides/ride-status.js';
import { ConflictError } from '../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../support/unit-context.js';

describe('PaymentSettlementService', () => {
  it('records the payment in the current round and makes the order a ready ride', async () => {
    const ctx = unitContext();
    const order = await ctx.paidOrder('w');
    const dto = await ctx.settlement.settle(order.id, 'w', 'sig-1');
    expect(dto.inserted).toBe(true);
    expect(dto.paidAt).toEqual(ctx.now());
    expect(dto.ride).toMatchObject({ status: 'created', roundId: 1 });
    expect(await ctx.payments.findBySignature('sig-1')).toMatchObject({ rideId: order.id, lamports: order.lamports, roundId: 1 });
  });

  it('a LATE payment on a lapsed order cancels the unstarted free ride that replaced it (credit back) and lets other unpaid orders lapse', async () => {
    const ctx = unitContext();
    const order = await ctx.paidOrder('w');
    order.expire(ctx.now()); await ctx.rides.save(order);
    const free = await ctx.freeRide('w');
    const player = await ctx.storedPlayer('w'); player.spendFreeRide(); await ctx.players.save(player); // the credit the free ride cost
    const otherOrder = await ctx.paidOrder('w');
    const settled = await ctx.settlement.settle(order.id, 'w', 'sig-late');
    expect(settled.cancelled.map((r) => r.id)).toEqual([free.id]);
    expect(settled.cancelled[0]).toMatchObject({ status: RideStatus.Cancelled, reason: 'replaced by a paid ride' });
    expect(settled.expired.map((r) => r.id)).toEqual([otherOrder.id]);
    expect(settled.expired[0]?.status).toBe(RideStatus.Expired);
    expect((await ctx.reload(order.id)).snapshot()).toMatchObject({ status: RideStatus.Created, endedAt: null, reason: null });
    expect((await ctx.reload(free.id)).status).toBe(RideStatus.Cancelled);
    expect((await ctx.reload(otherOrder.id)).status).toBe(RideStatus.Expired);
    expect((await ctx.storedPlayer('w')).freeRides).toBe(10);
    expect((await ctx.rides.listOpenByWallet('w')).map((r) => r.id)).toEqual([order.id]); // ONE ride in hand
  });

  it('never touches a running ride or another PAID ride', async () => {
    const ctx = unitContext();
    const running = await ctx.freeRide('w', true);
    const paid = await ctx.paidOrder('w');
    await ctx.settlement.settle(paid.id, 'w', 'sig-a');
    const second = await ctx.paidOrder('w');
    await ctx.settlement.settle(second.id, 'w', 'sig-b');
    expect((await ctx.reload(running.id)).status).toBe(RideStatus.Running);
    expect((await ctx.reload(paid.id)).status).toBe(RideStatus.Created);
    expect((await ctx.reload(second.id)).status).toBe(RideStatus.Created);
  });

  it('idempotent: settling the same payment again (a racing confirm / reconcile) answers "paid", never "already used"', async () => {
    const ctx = unitContext();
    const order = await ctx.paidOrder('w');
    await ctx.settlement.settle(order.id, 'w', 'sig-1');
    expect(await ctx.settlement.settle(order.id, 'w', 'sig-1')).toMatchObject({ inserted: false, paidAt: null, cancelled: [], expired: [], ride: { id: order.id, status: 'created' } });
  });

  it('a signature that already paid ANOTHER ride is a conflict', async () => {
    const ctx = unitContext();
    const a = await ctx.paidOrder('w');
    const b = await ctx.paidOrder('x');
    await ctx.settlement.settle(a.id, 'w', 'sig-1');
    await expect(ctx.settlement.settle(b.id, 'x', 'sig-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('when the round closed between choosing and locking it (the week just turned), it settles into the new round', async () => {
    const ctx = unitContext();
    const order = await ctx.paidOrder('w');
    let first = true;
    class TurningRounds extends RoundRepositoryPort {
      findContaining = (at: Date) => ctx.roundRepo.findContaining(at);
      findLatest = () => ctx.roundRepo.findLatest();
      insert = (r: Round) => ctx.roundRepo.insert(r);
      save = (r: Round) => ctx.roundRepo.save(r);
      entriesOf = (id: number) => ctx.roundRepo.entriesOf(id);
      async lockOpen(id: number) {
        if (!first) return ctx.roundRepo.lockOpen(id);
        first = false;
        ctx.clock.advance(7 * 86_400); // meanwhile a request of the new week…
        await ctx.rounds.ensureRound(); // …opened the next round and closed this one
        return ctx.roundRepo.lockOpen(id);
      }
    }
    const settlement = new PaymentSettlementService(ctx.rounds, new TurningRounds(), ctx.payments, ctx.rides, ctx.players, ctx.lookup, ctx.transactions, ctx.clock);
    expect(await settlement.settle(order.id, 'w', 'sig-1')).toMatchObject({ inserted: true, ride: { roundId: 2 } });
  });

  it('a conflict that is NOT this payment being recorded is passed on', async () => {
    const ctx = unitContext();
    const order = await ctx.paidOrder('w');
    class Broken extends PaymentRepositoryPort {
      findBySignature = async () => null;
      findByRide = async () => null;
      insert = async (_p: Payment) => { throw new ConflictError('boom'); };
      totalsOf = async () => ({ lamports: 0, count: 0 });
    }
    const settlement = new PaymentSettlementService(ctx.rounds, ctx.roundRepo, new Broken(), ctx.rides, ctx.players, ctx.lookup, ctx.transactions, ctx.clock);
    await expect(settlement.settle(order.id, 'w', 'sig')).rejects.toThrow('boom');
  });
});
