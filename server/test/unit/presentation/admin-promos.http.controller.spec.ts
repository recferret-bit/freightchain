import { AdminPromosHttpController } from '../../../src/presentation/admin/admin-promos.http.controller.js';
import { CreateAdminPromoCommand } from '../../../src/application/use-cases/admin/create-admin-promo/create-admin-promo.command.js';
import { DisableAdminPromoCommand } from '../../../src/application/use-cases/admin/disable-admin-promo/disable-admin-promo.command.js';
import { ListPromoRedemptionsQuery } from '../../../src/application/use-cases/admin/list-promo-redemptions/list-promo-redemptions.query.js';
import { RequestActionChallengeCommand } from '../../../src/application/use-cases/admin/request-action-challenge/request-action-challenge.command.js';
import { ListPromosQuery } from '../../../src/application/use-cases/promos/list-promos/list-promos.query.js';
import { createPromoBodySchema, disablePromoBodySchema, promoBodySchema, promoChallengeBodySchema, promoCodeParamsSchema, promoRedemptionsQuerySchema, promosQuerySchema } from '../../../src/presentation/admin/dto/admin-promos.dto.js';
import { busMock } from '../../support/bus.js';

const W = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';
const body = { code: ' welcome ', effect: { kind: 'free_rides', count: 3 }, description: ' Hi ', maxRedemptions: 50, perWallet: 2, startsAt: 1_800_000_000_000, expiresAt: 1_800_086_400_000, note: '' };
const parsed = promoBodySchema.parse(body);

describe('AdminPromosHttpController', () => {
  it('dispatches every route: lists, redemptions, the challenge, the signed create and disable (with the admin wallet and the request id)', async () => {
    const commands = busMock({ code: 'WELCOME' }), queries = busMock({ promos: [] });
    const c = new AdminPromosHttpController(commands.bus, queries.bus);
    await c.list(promosQuerySchema.parse({ state: 'active' })); expect(queries.last()).toEqual(new ListPromosQuery('active'));
    await c.list(promosQuerySchema.parse({})); expect(queries.last()).toEqual(new ListPromosQuery(null));
    await c.redemptions(promoRedemptionsQuerySchema.parse({ code: 'AB1', wallet: W, limit: '5' })); expect(queries.last()).toEqual(new ListPromoRedemptionsQuery(5, 'AB1', W));
    await c.redemptions(promoRedemptionsQuerySchema.parse({})); expect(queries.last()).toEqual(new ListPromoRedemptionsQuery(200, null, null));
    await c.challenge({ wallet: 'ADMIN' }, promoChallengeBodySchema.parse({ action: 'promo_create', promo: body }));
    expect(commands.last()).toEqual(new RequestActionChallengeCommand('ADMIN', { action: 'promo_create', promo: parsed }));
    await c.challenge({ wallet: 'ADMIN' }, promoChallengeBodySchema.parse({ action: 'promo_disable', code: ' welcome ' }));
    expect(commands.last()).toEqual(new RequestActionChallengeCommand('ADMIN', { action: 'promo_disable', code: 'welcome' }));
    expect(await c.create({ wallet: 'ADMIN' }, createPromoBodySchema.parse({ promo: body, signature: 'SIG' }), 'req-1')).toEqual({ code: 'WELCOME' });
    expect(commands.last()).toEqual(new CreateAdminPromoCommand('ADMIN', parsed, 'req-1', 'SIG'));
    await c.disable({ wallet: 'ADMIN' }, promoCodeParamsSchema.parse({ code: 'welcome' }), disablePromoBodySchema.parse({ signature: 'S2' }), 'req-2');
    expect(commands.last()).toEqual(new DisableAdminPromoCommand('ADMIN', 'welcome', 'req-2', 'S2'));
  });

  describe('DTO schemas', () => {
    it('a promo body becomes a PromoCreateInput: trimmed text, blank = none, epoch ms → dates, per-wallet defaults to 1', () => {
      expect(parsed).toEqual({
        code: 'welcome', effect: { kind: 'free_rides', count: 3 }, description: 'Hi', maxRedemptions: 50, perWallet: 2,
        startsAt: new Date(1_800_000_000_000), expiresAt: new Date(1_800_086_400_000), note: null,
      });
      expect(promoBodySchema.parse({ code: 'X1Y', effect: { kind: 'cosmetic', slot: 'wheel', item: 'gold' } })).toEqual({
        code: 'X1Y', effect: { kind: 'cosmetic', slot: 'wheel', item: 'gold' }, description: null, maxRedemptions: null, perWallet: 1, startsAt: null, expiresAt: null, note: null,
      });
    });
    it('tickets: a missing / blank pool id is "the live pool of the tier" – and the parse is the same for the text to sign and the change (key order is the schema\'s)', () => {
      const a = promoBodySchema.parse({ code: 'T1X', effect: { kind: 'tickets', tier: '4h', credits: 2 } });
      const b = promoBodySchema.parse({ code: 'T1X', effect: { credits: 2, poolId: '', tier: '4h', kind: 'tickets' } });
      expect(a.effect).toEqual({ kind: 'tickets', tier: '4h', poolId: null, credits: 2 });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
    it('refuses what is not a promo: unknown kinds, tiers and slots, bad numbers and dates, an over-long code, no signature', () => {
      const bad: unknown[] = [
        { code: 'A', effect: { kind: 'cash' } }, { code: 'A', effect: { kind: 'tickets', tier: 'free', credits: 1 } }, { code: 'A', effect: { kind: 'tickets', tier: '1h', credits: 0 } },
        { code: 'A', effect: { kind: 'free_rides', count: 1.5 } }, { code: 'A', effect: { kind: 'cosmetic', slot: 'seat', item: 'x' } }, { code: '', effect: { kind: 'free_rides', count: 1 } },
        { code: 'x'.repeat(65), effect: { kind: 'free_rides', count: 1 } }, { code: 'A', effect: { kind: 'free_rides', count: 1 }, startsAt: 'tomorrow' },
        { code: 'A', effect: { kind: 'free_rides', count: 1 }, maxRedemptions: 0 }, { code: 'A', effect: { kind: 'free_rides', count: 1 }, perWallet: 0 },
        { effect: { kind: 'free_rides', count: 1 } },
      ];
      for (const b of bad) expect(promoBodySchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
      expect(createPromoBodySchema.safeParse({ promo: body }).success).toBe(false);
      expect(createPromoBodySchema.safeParse({ promo: body, signature: '' }).success).toBe(false);
      expect(disablePromoBodySchema.safeParse({}).success).toBe(false);
    });
    it('the challenge is a new code or the disabling of one; the list takes a known state; redemptions a capped limit', () => {
      for (const b of [{ action: 'promo_create' }, { action: 'promo_disable' }, { action: 'delete', code: 'X1' }, {}]) expect(promoChallengeBodySchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
      expect(promosQuerySchema.parse({ state: '' })).toEqual({ state: null });
      expect(promosQuerySchema.safeParse({ state: 'old' }).success).toBe(false);
      for (const q of [{ limit: '0' }, { limit: '201' }, { wallet: 'nope' }]) expect(promoRedemptionsQuerySchema.safeParse(q).success, JSON.stringify(q)).toBe(false);
    });
  });
});
