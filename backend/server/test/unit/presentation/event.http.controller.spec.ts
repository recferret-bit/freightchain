import { EventHttpController } from '../../../src/presentation/event/event.http.controller.js';
import { GetEventBoardQuery } from '../../../src/application/use-cases/event/get-event-board/get-event-board.query.js';
import { publicEventResponse } from '../../../src/presentation/event/dto/event.dto.js';
import { busMock } from '../../support/bus.js';

describe('EventHttpController', () => {
  it('reads the public board through the query bus and the response schema accepts it', async () => {
    const dto = { eventId: 'e', phase: 'pending', reviewEnd: null, appealsEnd: null, rows: [] };
    const queries = busMock(dto);
    expect(await new EventHttpController(queries.bus).board()).toEqual(dto);
    expect(queries.last()).toEqual(new GetEventBoardQuery());
    expect(publicEventResponse.safeParse(dto).success).toBe(true);
    expect(publicEventResponse.safeParse({ ...dto, phase: 'hidden' }).success).toBe(false);
  });
});
