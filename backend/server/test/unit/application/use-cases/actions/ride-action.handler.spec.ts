import type { QueryBus } from '@nestjs/cqrs';
import type { RulesConfigPort } from '../../../../../src/application/ports/config/rules-config.port.js';
import type { PoolRepositoryPort } from '../../../../../src/application/ports/economy/pool.repository.port.js';
import type { ClockPort } from '../../../../../src/application/ports/shared/clock.port.js';
import { GetPublicRideQuery } from '../../../../../src/application/use-cases/rides/get-public-ride/get-public-ride.query.js';
import { GetRideActionHandler, OpenRideActionHandler } from '../../../../../src/application/use-cases/actions/ride-action.handler.js';
import { GetRideActionQuery } from '../../../../../src/application/use-cases/actions/get-ride-action.query.js';
import { OpenRideActionCommand } from '../../../../../src/application/use-cases/actions/open-ride-action.command.js';

const ride = { id: 'ride-1', route: 'route-66', tier: 'free', status: 'running', km: 3.2, reason: null, verdict: { status: 'verified', reasons: ['human'] } };
const rules = { get: () => ({ paymentMode: 'transfer', programId: '', appOrigin: 'https://freightchain.fun', gameOrigin: 'https://ride.freightchain.fun' }) } as unknown as RulesConfigPort;
const execute = vi.fn(async () => ride);
const queries = { execute } as unknown as QueryBus;

describe('ride actions', () => {
  it('describes the public ride without saying verified, and posts an external link', async () => {
    const card = await new GetRideActionHandler(queries, rules, { listLive: async () => [] } as unknown as PoolRepositoryPort, { now: () => new Date() } as ClockPort).execute(new GetRideActionQuery('ride-1'));
    expect(JSON.stringify(card).toLowerCase()).not.toContain('verified');
    expect(card.links.actions.map((a) => a.label)).toEqual(['Open the ride']);
    expect(execute).toHaveBeenCalledWith(new GetPublicRideQuery('ride-1'));
    const link = await new OpenRideActionHandler(queries, rules).execute(new OpenRideActionCommand('ride-1', 'Wallet'));
    expect(link).toEqual({ type: 'external-link', externalLink: 'https://freightchain.fun/r/ride-1', message: 'Opens the ride page. Devnet.' });
    const freeLive = await new OpenRideActionHandler(queries, rules).execute(new OpenRideActionCommand('ride-1', 'Wallet', 'watch'));
    expect(freeLive.externalLink).toBe('https://freightchain.fun/r/ride-1'); // a live free ride has no watch page
    execute.mockResolvedValueOnce({ ...ride, tier: '1h', status: 'completed' });
    const watch = await new OpenRideActionHandler(queries, rules).execute(new OpenRideActionCommand('ride-1', 'Wallet', 'watch'));
    expect(watch).toMatchObject({ type: 'external-link', externalLink: 'https://ride.freightchain.fun/play.html?watch=ride-1' });
  });
});
