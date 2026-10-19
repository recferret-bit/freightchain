import { RoundRepositoryPort, type RoundEntries } from '../../../../src/application/ports/economy/round.repository.port.js';
import { RoundService } from '../../../../src/application/services/round.service.js';
import { Payment } from '../../../../src/domain/economy/payment.entity.js';
import { Round, RoundStatus } from '../../../../src/domain/economy/round.entity.js';
import { MemoryTransaction } from '../../../support/in-memory/memory-repositories.js';
import { FakeClock } from '../../../support/fake-clock.js';
import { RecordingAnalytics } from '../../../support/recording-analytics.js';
import { FixedRules, unitContext, unitRules } from '../../../support/unit-context.js';

describe('RoundService', () => {
  it('the first round of all is seeded with the configured initial seed', async () => {
    const ctx = unitContext(unitRules({ initialSeedLamports: 777 }));
    expect((await ctx.rounds.ensureRound()).carry).toBe(777);
    expect(ctx.analytics.named('round_opened')).toHaveLength(1);
    expect(ctx.analytics.named('round_closed')).toEqual([]);
  });

  it('a new week closes the old round and carries its 20 % – an empty week passes its own carry on', async () => {
    const ctx = unitContext(unitRules({ initialSeedLamports: 100 }));
    const first = await ctx.rounds.ensureRound();
    await ctx.payments.insert(new Payment({ signature: 's', rideId: 'r', wallet: 'w', lamports: 1000, usd: 1, roundId: first.id, at: ctx.now() }));
    ctx.clock.advance(7 * 86_400);
    const second = await ctx.rounds.ensureRound();
    expect(second.carry).toBe(200); // 20 % of 1000 (the first round had entries: its own carry went into ITS grand prize)
    expect((await ctx.roundRepo.findLatest())?.id).toBe(second.id);
    expect(ctx.db.rounds.find((r) => r.id === first.id)?.status).toBe(RoundStatus.Closed);
    ctx.clock.advance(7 * 86_400);
    expect((await ctx.rounds.ensureRound()).carry).toBe(200); // nobody entered week 2: its carry goes on
  });

  it("the loser of the first-request-of-the-week race uses the winner's round and closes nothing", async () => {
    const clock = new FakeClock();
    const monday = Date.UTC(2036, 9, 6);
    const old = Round.restore({ id: 1, startsAt: new Date(monday - 7 * 86_400_000), endsAt: new Date(monday), carry: 0, status: RoundStatus.Open });
    const winner = Round.restore({ id: 2, startsAt: new Date(monday), endsAt: new Date(monday + 7 * 86_400_000), carry: 50, status: RoundStatus.Open });
    let finds = 0, saves = 0;
    class Racing extends RoundRepositoryPort {
      async findContaining() { return finds++ === 0 ? null : winner; }
      async findLatest() { return old; }
      async insert() { return null; } // the unique week start: someone else created it
      async save() { saves++; }
      async entriesOf(): Promise<RoundEntries> { return { lamports: 0, count: 0 }; }
      async lockOpen() { return true; }
    }
    const analytics = new RecordingAnalytics();
    expect((await new RoundService(new Racing(), new FixedRules(), new MemoryTransaction(), clock, analytics).ensureRound()).id).toBe(2);
    expect(saves).toBe(0);
    expect(analytics.events).toEqual([]);
  });

  it('locks the previous round before reading its entries (so a payment settling into it is counted)', async () => {
    const order: string[] = [];
    const ctx = unitContext();
    await ctx.rounds.ensureRound();
    ctx.clock.advance(7 * 86_400);
    class Spy extends RoundRepositoryPort {
      findContaining = (at: Date) => ctx.roundRepo.findContaining(at);
      findLatest = () => ctx.roundRepo.findLatest();
      insert = (r: Round) => ctx.roundRepo.insert(r);
      save = (r: Round) => ctx.roundRepo.save(r);
      entriesOf = async (id: number) => { order.push('entries'); return ctx.roundRepo.entriesOf(id); };
      lockOpen = async (id: number) => { order.push('lock'); return ctx.roundRepo.lockOpen(id); };
    }
    await new RoundService(new Spy(), ctx.rules, ctx.transactions, ctx.clock, new RecordingAnalytics()).ensureRound();
    expect(order).toEqual(['lock', 'entries']);
  });
});
