import { AdminEventHttpController } from '../../../src/presentation/event/admin-event.http.controller.js';
import { RequestActionChallengeCommand } from '../../../src/application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { CheckEventSanctionsCommand } from '../../../src/application/use-cases/event/check-event-sanctions/check-event-sanctions.command.js';
import { GetAdminEventQuery } from '../../../src/application/use-cases/event/get-admin-event/get-admin-event.query.js';
import { LockEventListCommand } from '../../../src/application/use-cases/event/lock-event-list/lock-event-list.command.js';
import { RecordEventPayoutCommand } from '../../../src/application/use-cases/event/record-event-payout/record-event-payout.command.js';
import { ReviewEventWalletCommand } from '../../../src/application/use-cases/event/review-event-wallet/review-event-wallet.command.js';
import { SetEventPrizeTableCommand } from '../../../src/application/use-cases/event/set-event-prize-table/set-event-prize-table.command.js';
import { PRESEASON_EVENT_ID } from '../../../src/domain/prize/event-settlement.js';
import { eventChallengeBodySchema, payoutBodySchema, reviewBodySchema, txSignatureSchema } from '../../../src/presentation/event/dto/event.dto.js';
import { busMock } from '../../support/bus.js';

const admin = { wallet: 'ADMIN' } as never;
const W = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const SIG = '5'.repeat(88);

describe('AdminEventHttpController', () => {
  it('dispatches every route to its command or query with the admin wallet', async () => {
    const commands = busMock<unknown>({ wallet: W, disqualified: false, prizeEligibleOverride: null, note: null, sanctionsCheckedAt: null, sanctionsClean: null, sanctionsRef: null, updatedBy: 'a', updatedAt: new Date(5) });
    const c = new AdminEventHttpController(commands.bus, commands.bus);
    await c.event();
    expect(commands.last()).toEqual(new GetAdminEventQuery());
    await c.challenge(admin, { action: 'event_lock' });
    expect(commands.last()).toEqual(new RequestActionChallengeCommand('ADMIN', { action: 'event_lock', eventId: PRESEASON_EVENT_ID }));
    await c.challenge(admin, { action: 'event_review', wallet: W, disqualified: true, prizeEligible: false, note: 'n' });
    expect(commands.last()).toEqual(new RequestActionChallengeCommand('ADMIN', { action: 'event_review', wallet: W, disqualified: true, prizeEligible: false, note: 'n' }));
    await c.challenge(admin, { action: 'event_payout', wallet: W, txSignature: SIG });
    expect(commands.last()).toEqual(new RequestActionChallengeCommand('ADMIN', { action: 'event_payout', wallet: W, txSignature: SIG }));
    expect(await c.review(admin, { wallet: W, disqualified: true, prizeEligible: false, note: 'n', signature: 's' }, 'rq')).toMatchObject({ wallet: W, updatedAt: 5 });
    expect(commands.last()).toEqual(new ReviewEventWalletCommand('ADMIN', W, true, false, 'n', 'rq', 's'));
    await c.sanctions(admin, { wallet: W, signature: 's' }, 'rq');
    expect(commands.last()).toEqual(new CheckEventSanctionsCommand('ADMIN', W, 'rq', 's'));
    await c.prizeTable(admin, { cents: [1, 2], signature: 's' }, 'rq');
    expect(commands.last()).toEqual(new SetEventPrizeTableCommand('ADMIN', [1, 2], 'rq', 's'));
    await c.lock(admin, { signature: 's' }, 'rq');
    expect(commands.last()).toEqual(new LockEventListCommand('ADMIN', 'rq', 's'));
    await c.payout(admin, { wallet: W, txSignature: SIG, signature: 's' }, 'rq');
    expect(commands.last()).toEqual(new RecordEventPayoutCommand('ADMIN', W, SIG, 'rq', 's'));
  });

  it('bodies are strict: a base58 signature of the right length, geo cannot be overridden upward, no extra fields', () => {
    expect(txSignatureSchema.safeParse(SIG).success).toBe(true);
    expect(txSignatureSchema.safeParse('short').success).toBe(false);
    expect(txSignatureSchema.safeParse('0'.repeat(88)).success).toBe(false);
    expect(reviewBodySchema.safeParse({ wallet: W, disqualified: false, prizeEligible: true, note: null, signature: 's' }).success).toBe(false);
    expect(payoutBodySchema.safeParse({ wallet: W, txSignature: SIG, signature: 's', amountCents: 1 }).success).toBe(false);
    expect(eventChallengeBodySchema.safeParse({ action: 'event_prize_table', cents: Array(21).fill(1) }).success).toBe(false);
    expect(eventChallengeBodySchema.safeParse({ action: 'event_lock', eventId: 'x' }).success).toBe(false);
  });
});
