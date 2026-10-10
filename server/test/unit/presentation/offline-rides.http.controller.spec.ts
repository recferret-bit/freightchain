import { OfflineRidesHttpController } from '../../../src/presentation/offline/offline-rides.http.controller.js';
import { ClaimOfflineRideCommand } from '../../../src/application/use-cases/offline/claim-offline-ride/claim-offline-ride.command.js';
import { GetOfflineRidesQuery } from '../../../src/application/use-cases/offline/get-offline-rides/get-offline-rides.query.js';
import { offlineBodySchema, offlineQuerySchema } from '../../../src/presentation/offline/dto/offline-rides.dto.js';
import { busMock } from '../../support/bus.js';

const FP = 'ab'.repeat(32);

describe('OfflineRidesHttpController', () => {
  it('dispatches status and claim with the session wallet (or null) and the server address, never a client-sent one', async () => {
    const commands = busMock({ claimed: true }), queries = busMock({ allowed: true });
    const c = new OfflineRidesHttpController(commands.bus, queries.bus);
    await c.status(null, offlineQuerySchema.parse({ fingerprint: FP }), { ip: '1.2.3.4', userAgent: 'UA' });
    expect(queries.last()).toEqual(new GetOfflineRidesQuery(null, FP, '1.2.3.4'));
    await c.claim('wallet', offlineBodySchema.parse({ fingerprint: FP }), { ip: '9.9.9.9', userAgent: null });
    expect(commands.last()).toEqual(new ClaimOfflineRideCommand('wallet', FP, '9.9.9.9'));
  });

  it('the fingerprint is 64 lowercase hex characters', () => {
    expect(offlineQuerySchema.parse({ fingerprint: FP })).toEqual({ fingerprint: FP });
    expect(offlineBodySchema.parse({ fingerprint: FP })).toEqual({ fingerprint: FP });
    for (const bad of ['', 'A'.repeat(64), 'g'.repeat(64), FP.slice(1), `${FP}a`]) {
      expect(offlineBodySchema.safeParse({ fingerprint: bad }).success, bad).toBe(false);
    }
  });
});
