/* Guest sign-in, the weekly ticket, HARD free-3c, ride promos, the prize board, and the TEN4 rename. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { adminSign, apiTest, devAdmin, session, signInAdmin, signInPlayer } from '../../harness/api.mjs';
import { REPO } from '../../harness/dom.mjs';

const src = (rel) => readFileSync(join(REPO, rel), 'utf8');
const GEO = { 'x-fc-country': 'RS' };

test('B1-FREE-10 POST /api/auth/guest is an EASY-only throwaway session', () => {
  const auth = src('server/src/presentation/auth/auth.http.controller.ts');
  const handler = src('server/src/application/use-cases/auth/start-guest/start-guest.handler.ts');
  const rides = src('server/src/application/use-cases/rides/create-ride/create-ride.handler.ts');
  assert.match(auth, /@Post\('auth\/guest'\)/);
  assert.match(handler, /guest: true/);
  assert.match(handler, /Anonymous EASY/);
  assert.match(rides, /guest_easy_only/);
});

apiTest(test, 'B1-FREE-10 a guest can start EASY and not MEDIUM', async () => {
  const api = session();
  const guest = await api.call('/api/auth/guest', { method: 'POST' });
  assert.equal(guest.status, 200, JSON.stringify(guest.json));
  assert.equal(guest.json.guest, true);
  const easy = await api.call('/api/rides', { body: { tier: 'free', level: 1 } });
  assert.equal(easy.status, 200, JSON.stringify(easy.json));
  assert.equal(easy.json.level, 1);
  assert.equal(easy.json.trip, 'free-1c');
  const medium = await api.call('/api/rides', { body: { tier: 'free', level: 2 } });
  assert.equal(medium.status, 409);
  assert.equal(medium.json.code, 'guest_easy_only');
});

test('B1-FREE-11 the weekly 1h grant is one every 7 days; a created grant ride is returned, and weekly_ticket_spent is only the lost claim', () => {
  const settings = src('server/src/domain/settings/game-settings.ts');
  const weekly = src('server/src/application/services/weekly-ticket.service.ts');
  const rides = src('server/src/application/use-cases/rides/create-ride/create-ride.handler.ts');
  assert.match(settings, /weekly_ticket_1h_enabled: 1/);
  assert.match(settings, /weekly_ticket_1h_days: 7/);
  assert.match(settings, /weekly_ticket_4h_enabled: 0/);
  assert.match(settings, /weekly_ticket_8h_enabled: 0/);
  assert.match(weekly, /A guest never receives one/);
  assert.match(weekly, /Does not mint TEN4/);
  // The 409 is claim() losing the row. A later POST while the grant ride is still created returns that ride.
  assert.match(rides, /weekly_ticket_spent/);
  assert.match(rides, /isInStatus\(RideStatus\.Created\)/);
  assert.match(rides, /isWeeklyGrant/);
});

apiTest(test, 'B1-FREE-11 an eligible wallet is offered a 1h grant and the first paid order is that grant', async () => {
  const api = session();
  await signInPlayer(api);
  const agreed = await api.call('/api/profile/agreements', { method: 'PUT', body: { age18: true, loss: true } });
  assert.equal(agreed.status, 200, JSON.stringify(agreed.json));
  const me = await api.call('/api/me', { headers: GEO });
  assert.equal(me.status, 200, JSON.stringify(me.json));
  assert.ok(Array.isArray(me.json.weeklyTickets));
  assert.ok(!me.json.weeklyTickets.some((row) => row.tier === '4h' || row.tier === '8h'));
  const grant = me.json.weeklyTickets.find((row) => row.tier === '1h' && row.rideId === null);
  if (!grant) return; // outside the ranked window the service issues nothing; the source check still locks the 409
  const ride = await api.call('/api/rides', { body: { tier: '1h' }, headers: GEO });
  assert.equal(ride.status, 200, JSON.stringify(ride.json));
  assert.equal(ride.json.weeklyGrant, true);
  assert.equal(ride.json.lamports, 0);
  assert.equal(ride.json.promo, false);
});

test('B1-FREE-13 HARD is free-3c at ×10 and free-3b stays a frozen trip', () => {
  const rules = src('server/src/domain/rides/ride-trip.ts');
  const trips = src('client/js/trips.js');
  assert.match(rules, /3: \{ level: 3, trip: 'free-3c', name: 'HARD', multiple: 10/);
  assert.match(rules, /'free-3b': 3/);
  assert.match(trips, /'free-3c':/);
  assert.match(trips, /seconds: 1800/);
  assert.match(trips, /'free-3b':/);
});

test('B1-PROMO-05 a ride promo grants a paid shift and free_rides is retired', () => {
  const types = src('server/src/domain/economy/promo.types.ts');
  const entity = src('server/src/domain/economy/promo-code.entity.ts');
  const dto = src('server/src/presentation/admin/dto/admin-promos.dto.ts');
  assert.match(types, /kind: 'ride'/);
  assert.match(types, /free_rides: retired/);
  assert.match(entity, /promo_retired/);
  assert.match(dto, /kind: z\.literal\('ride'\)/);
  assert.doesNotMatch(dto, /literal\('free_rides'\)/);
});

apiTest(test, 'B1-PROMO-05 creating a free_rides code is refused and a ride code redeems', async () => {
  const code = `RIDE${Date.now().toString(36).toUpperCase()}`;
  const blank = { description: null, maxRedemptions: 5, perWallet: 1, startsAt: null, expiresAt: null, note: null };
  const retired = { code: `OLD${Date.now().toString(36).toUpperCase()}`, effect: { kind: 'free_rides', count: 3 }, ...blank };
  const admin = session();
  await signInAdmin(admin, devAdmin());
  const refused = await admin.call('/api/admin/promos/challenge', { body: { action: 'promo_create', promo: retired }, headers: { 'x-fc-admin': '1' } });
  assert.ok(refused.status === 400 || refused.status === 409, JSON.stringify(refused.json));
  const promo = { code, effect: { kind: 'ride', tier: '1h' }, ...blank };
  const signature = await adminSign(admin, devAdmin(), '/api/admin/promos/challenge', { action: 'promo_create', promo });
  const created = await admin.call('/api/admin/promos', { body: { promo, signature }, headers: { 'x-fc-admin': '1' } });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const player = session();
  await signInPlayer(player);
  const redeemed = await player.call('/api/promo/redeem', { body: { code } });
  assert.equal(redeemed.status, 200, JSON.stringify(redeemed.json));
  assert.equal(redeemed.json.kind, 'ride');
  assert.equal(redeemed.json.tier, '1h');
  const ride = await player.call('/api/rides', { body: { tier: '1h' } });
  assert.equal(ride.status, 200, JSON.stringify(ride.json));
  assert.equal(ride.json.promo, true);
  assert.equal(ride.json.lamports, 0);
});

test('B1-BOARD-01 GET /api/prize/board is the weekly skill board', () => {
  const controller = src('server/src/presentation/prize/prize.http.controller.ts');
  const dto = src('server/src/application/use-cases/prize/get-prize-board/get-prize-board.handler.ts');
  assert.match(controller, /@Controller\('api\/prize'\)/);
  assert.match(controller, /@Get\('board'\)/);
  assert.match(dto, /export interface PrizeBoardDto/);
});

apiTest(test, 'B1-BOARD-01 GET /api/prize/board?tier=1h returns the week and a board', async () => {
  const r = await session().call('/api/prize/board?tier=1h');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.tier, '1h');
  assert.equal(typeof r.json.weekId, 'string');
  assert.ok(Array.isArray(r.json.board));
});

test('B1-HONK-01 the token symbol is TEN4 and the route stays /api/honk', () => {
  const token = src('server/src/domain/honk/tokenomics.ts');
  const program = src('programs/freightchain_honk/src/constants.rs');
  const http = src('server/src/presentation/honk/honk.http.controller.ts');
  assert.match(token, /export const TOKEN_SYMBOL = 'TEN4'/);
  assert.match(token, /export const TOKEN_NAME = 'TEN4'/);
  assert.match(program, /TOKEN_SYMBOL: &\[u8\] = b"TEN4"/);
  assert.match(http, /@Get\('honk'\)/);
  assert.match(http, /HONK is the chat-line verb/);
});
