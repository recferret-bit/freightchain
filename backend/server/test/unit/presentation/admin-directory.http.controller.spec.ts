import { AdminDirectoryHttpController } from '../../../src/presentation/admin/admin-directory.http.controller.js';
import { GetAdminPlayerQuery } from '../../../src/application/use-cases/admin/get-admin-player/get-admin-player.query.js';
import { GetAdminPoolQuery } from '../../../src/application/use-cases/admin/get-admin-pool/get-admin-pool.query.js';
import { GetAdminQueueCountQuery } from '../../../src/application/use-cases/admin/get-admin-queue-count/get-admin-queue-count.query.js';
import { GetAdminStatsQuery } from '../../../src/application/use-cases/admin/get-admin-stats/get-admin-stats.query.js';
import { ListAdminPlayersQuery } from '../../../src/application/use-cases/admin/list-admin-players/list-admin-players.query.js';
import { ListAdminPoolsQuery } from '../../../src/application/use-cases/admin/list-admin-pools/list-admin-pools.query.js';
import { ListAdminSessionsQuery } from '../../../src/application/use-cases/admin/list-admin-sessions/list-admin-sessions.query.js';
import { adminStatsQuerySchema, playersQuerySchema, poolIdParamsSchema, poolsQuerySchema, sessionsQuerySchema, walletParamsSchema } from '../../../src/presentation/admin/dto/admin-directory.dto.js';
import { busMock } from '../../support/bus.js';

const W = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';

describe('AdminDirectoryHttpController', () => {
  it('dispatches every route to the query bus with its parsed parameters (defaults included)', async () => {
    const queries = busMock({ rows: [] });
    const c = new AdminDirectoryHttpController(queries.bus);
    await c.queueCount();
    expect(queries.last()).toEqual(new GetAdminQueueCountQuery());
    await c.players(playersQuerySchema.parse({ q: 'Gse' }));
    expect(queries.last()).toEqual(new ListAdminPlayersQuery(100, 'Gse'));
    await c.player({ wallet: 'ADMIN' }, walletParamsSchema.parse({ wallet: W }));
    expect(queries.last()).toEqual(new GetAdminPlayerQuery(W, 'ADMIN'));
    await c.pools(poolsQuerySchema.parse({}));
    expect(queries.last()).toEqual(new ListAdminPoolsQuery(100));
    await c.pool(poolIdParamsSchema.parse({ id: '7' }));
    expect(queries.last()).toEqual(new GetAdminPoolQuery(7));
    await c.stats(adminStatsQuerySchema.parse({}));
    expect(queries.last()).toEqual(new GetAdminStatsQuery(30, 20));
    await c.sessions(sessionsQuerySchema.parse({ days: '3' }));
    expect(queries.last()).toEqual(new ListAdminSessionsQuery(3));
  });

  describe('DTO schemas', () => {
    it('q is a base58 wallet prefix (blank = none); limits, days and top are bounded; a wallet param is a real address; a pool id is a u32', () => {
      expect(playersQuerySchema.parse({ q: '' })).toEqual({ limit: 100 });
      for (const bad of [{ q: 'has space' }, { q: '0OIl' }, { limit: 0 }, { limit: 201 }]) expect(playersQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(walletParamsSchema.safeParse({ wallet: 'nope' }).success).toBe(false);
      for (const bad of [{ id: '-1' }, { id: '1.5' }, { id: '2147483648' }, { id: 'x' }]) expect(poolIdParamsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      for (const bad of [{ days: 0 }, { days: 366 }, { top: 101 }]) expect(adminStatsQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      for (const bad of [{ days: 0 }, { days: 31 }]) expect(sessionsQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    });
  });
});
