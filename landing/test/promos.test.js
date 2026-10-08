import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promoFromForm, localToMs } from '../../client/site/admin-promos.js';
import { itemName, SLOT_NAME } from '../../client/site/lobby-promo.js';
import { COSMETICS, LOOKS, SLOTS, defaultLoadout, loadout, look, setLoadout } from '../../client/js/cosmetics.js';

/* The admin page's promo form, the lobby's wardrobe wording and the client cosmetics catalog (mirrored from server/src/domain/economy/cosmetics.ts – the server's
   cosmetics.spec.ts compares the lists; here: every item has a look, junk never breaks the cockpit). */
const base = { code: ' welcome ', kind: 'free_rides', rides: '3', tier: '1h', credits: '1', poolId: '', slot: 'wheel', item: 'sport', description: '  Hi ', start: '', end: '', max: '', perWallet: '', note: '' };

test('the form → a promo body: trimmed text, blank = none, per wallet defaults to 1', () => {
  assert.deepEqual(promoFromForm(base), { code: 'welcome', effect: { kind: 'free_rides', count: 3 }, description: 'Hi', maxRedemptions: null, perWallet: 1, startsAt: null, expiresAt: null, note: null });
  assert.deepEqual(promoFromForm({ ...base, kind: 'tickets', tier: '4h', credits: '2', poolId: '7', max: '50', perWallet: '2', note: ' vip ' }),
    { code: 'welcome', effect: { kind: 'tickets', tier: '4h', poolId: 7, credits: 2 }, description: 'Hi', maxRedemptions: 50, perWallet: 2, startsAt: null, expiresAt: null, note: 'vip' });
  assert.deepEqual(promoFromForm({ ...base, kind: 'cosmetic', slot: 'truck_color', item: 'blue' }).effect, { kind: 'cosmetic', slot: 'truck_color', item: 'blue' });
});

test('1 and 3 free rides are the presets – any whole number up works, nonsense is a sentence, not a signature request', () => {
  assert.equal(promoFromForm({ ...base, rides: '1' }).effect.count, 1);
  for (const rides of ['0', '1.5', '', 'x']) assert.throws(() => promoFromForm({ ...base, rides }), /Free rides/, rides);
  assert.throws(() => promoFromForm({ ...base, code: '  ' }), /Give the code a name/);
  assert.throws(() => promoFromForm({ ...base, kind: 'tickets', credits: '0' }), /Tickets/);
  assert.throws(() => promoFromForm({ ...base, kind: 'tickets', tier: 'free' }), /ride length/);
  assert.throws(() => promoFromForm({ ...base, max: '0' }), /Max redemptions/);
  assert.throws(() => promoFromForm({ ...base, perWallet: '0' }), /Per wallet/);
});

test('cosmetics: only an item of the slot that is not its default can be given', () => {
  for (const item of [COSMETICS.wheel[0], 'racing', '']) assert.throws(() => promoFromForm({ ...base, kind: 'cosmetic', slot: 'wheel', item }), /Pick an item/, item);
});

test('times: a datetime-local value is the admin\'s own time; the end must come after the start', () => {
  assert.equal(localToMs(''), null); assert.ok(Number.isNaN(localToMs('soon')));
  assert.equal(localToMs('2036-10-09T12:00'), new Date(2036, 9, 9, 12, 0).getTime());
  const p = promoFromForm({ ...base, start: '2036-10-09T12:00', end: '2036-10-10T12:00' });
  assert.equal(p.expiresAt - p.startsAt, 86_400_000);
  assert.throws(() => promoFromForm({ ...base, start: '2036-10-09T12:00', end: '2036-10-09T12:00' }), /after the start/);
  assert.throws(() => promoFromForm({ ...base, end: '2001-01-01T00:00' }), /after the start/);
  assert.throws(() => promoFromForm({ ...base, start: 'later' }), /not a valid date/);
});

test('the client catalog: three slots, every item has a look and a name, the default is the first of each', () => {
  assert.deepEqual(SLOTS, ['wheel', 'truck_color', 'gearbox']);
  for (const slot of SLOTS) {
    assert.ok(SLOT_NAME[slot], slot);
    assert.deepEqual(Object.keys(LOOKS[slot]), COSMETICS[slot], `${slot}: LOOKS lists the same items in the same order`);
    for (const item of COSMETICS[slot]) assert.notEqual(itemName(item), undefined, item);
  }
  assert.deepEqual(defaultLoadout(), { wheel: 'classic', truck_color: 'red', gearbox: 'stick' });
});

test('setLoadout keeps what is known and falls back to the default for junk (a hostile or stale server value cannot break the cockpit)', () => {
  setLoadout({ wheel: 'gold', truck_color: '<script>', gearbox: 7, seat: 'x' });
  assert.deepEqual({ ...loadout }, { wheel: 'gold', truck_color: 'red', gearbox: 'stick' });
  assert.equal(look('wheel').rim, LOOKS.wheel.gold.rim);
  setLoadout(null);
  assert.deepEqual({ ...loadout }, defaultLoadout());
});

test('the cockpit is the only place that draws cosmetics; the module stays a leaf (the landing\'s dash cards run the cockpit without three.js)', () => {
  const src = readFileSync(join(new URL('..', import.meta.url).pathname, '..', 'client', 'js', 'cosmetics.js'), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'no imports');
});
