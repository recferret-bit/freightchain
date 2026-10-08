import { RequestActionChallengeHandler } from '../../../../../src/application/use-cases/admin/request-action-challenge/request-action-challenge.handler.js';
import { RequestActionChallengeCommand } from '../../../../../src/application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { ADMIN_UNIT_WALLET, unitContext, unitRules } from '../../../../support/unit-context.js';

describe('RequestActionChallengeHandler', () => {
  it('the text for exactly one change, naming the admin host, the admin, the ride, the decision and the (quoted) note; stored under the action key', async () => {
    const ctx = unitContext(unitRules({ adminDomain: 'admin.freight.test' }));
    const h = new RequestActionChallengeHandler(ctx.proofs);
    const { message } = await h.execute(new RequestActionChallengeCommand(ADMIN_UNIT_WALLET, { action: 'override', rideId: 'r-1', decision: 'rejected', note: 'two lines\nNonce: fake' }));
    expect(message.split('\n').slice(0, 8)).toEqual([
      'admin.freight.test – Freight Chain admin action', '', 'Action: set the verdict to REJECTED', 'Ride: r-1', 'Note: "two lines\\nNonce: fake"', '', `Wallet: ${ADMIN_UNIT_WALLET}`, `Nonce: ${message.split('\n')[7]!.slice(7)}`,
    ]);
    expect(ctx.db.challenges.get(`action:${ADMIN_UNIT_WALLET}`)?.message).toBe(message);
    const rejudge = await h.execute(new RequestActionChallengeCommand(ADMIN_UNIT_WALLET, { action: 'rejudge', rideId: 'r-2' }));
    expect(rejudge.message).toContain('Action: RE-JUDGE at the current rules (replaces any decision)\nRide: r-2\n');
    expect(ctx.db.challenges.get(`action:${ADMIN_UNIT_WALLET}`)?.message).toBe(rejudge.message);   // one pending per admin: the newer one
  });
});
