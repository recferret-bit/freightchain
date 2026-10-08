import { LiveHttpController } from '../../../src/presentation/live/live.http.controller.js';
import { AckEffectCommand } from '../../../src/application/use-cases/live/ack-effect/ack-effect.command.js';
import { GetInboxQuery } from '../../../src/application/use-cases/live/get-inbox/get-inbox.query.js';
import { PostRideEventCommand } from '../../../src/application/use-cases/live/post-ride-event/post-ride-event.command.js';
import { WatchRideQuery } from '../../../src/application/use-cases/live/watch-ride/watch-ride.query.js';
import { busMock } from '../../support/bus.js';

describe('LiveHttpController', () => {
  it('dispatches every route to the bus with the signed-in wallet where there is one', async () => {
    const commands = busMock({ id: 1 }), queries = busMock({ now: 1 });
    const c = new LiveHttpController(commands.bus, queries.bus);
    expect(await c.watch({ id: 'R' }, { from: 3, after: 7, viewer: 'v', since: 99 }, { ip: '10.0.0.1', userAgent: null })).toEqual({ now: 1 });
    expect(queries.last()).toEqual(new WatchRideQuery('R', 3, 7, 'v', 99, '10.0.0.1'));
    await c.inbox({ wallet: 'D' }, { id: 'R' }, { after: 5 });
    expect(queries.last()).toEqual(new GetInboxQuery('D', 'R', 5));
    expect(await c.message({ wallet: 'F' }, { id: 'R' }, { text: 'hi' })).toEqual({ id: 1 });
    expect(commands.last()).toEqual(new PostRideEventCommand('F', 'R', { kind: 'message', text: 'hi' }));
    await c.donate({ wallet: 'F' }, { id: 'R' }, { effect: 'night', note: null });
    expect(commands.last()).toEqual(new PostRideEventCommand('F', 'R', { kind: 'donation', effect: 'night', note: null }));
    await c.applied({ wallet: 'D' }, { id: 'R', eventId: 9 }, { t: 1, s: 2, lat: null, missed: true });
    expect(commands.last()).toEqual(new AckEffectCommand('D', 'R', 9, { t: 1, s: 2, lat: null, missed: true }));
  });
});
