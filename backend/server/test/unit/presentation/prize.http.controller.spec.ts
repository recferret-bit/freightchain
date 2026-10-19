import { PrizeHttpController } from '../../../src/presentation/prize/prize.http.controller.js';
import { GetPrizeBoardQuery } from '../../../src/application/use-cases/prize/get-prize-board/get-prize-board.query.js';
import { prizeBoardQuerySchema } from '../../../src/presentation/prize/dto/prize.dto.js';
import { busMock } from '../../support/bus.js';

describe('PrizeHttpController', () => {
  it('reads the skill board for the asked tier and week', async () => {
    const queries = busMock({ weekId: '2026-10-12', board: [] });
    const c = new PrizeHttpController(queries.bus);
    await c.board({ tier: '8h' });
    expect(queries.last()).toEqual(new GetPrizeBoardQuery('8h', null));
    await c.board({ tier: '1h', at: '2026-10-12T19:00:00.000Z' });
    expect(queries.last()).toEqual(new GetPrizeBoardQuery('1h', new Date('2026-10-12T19:00:00.000Z')));
    expect(prizeBoardQuerySchema.safeParse({ tier: '2h' }).success).toBe(false);
    expect(prizeBoardQuerySchema.safeParse({ tier: '4h', at: 'monday' }).success).toBe(false);
  });
});
