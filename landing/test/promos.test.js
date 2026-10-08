import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promoFromForm, localToMs } from '../../client/site/admin-promos.js';
import { itemName, SLOT_NAME } from '../../client/site/lobby-promo.js';
import { COSMETICS, LOOKS, SLOTS, defaultLoadout, loadout, look, setLoadout } from '../../client/js/cosmetics.js';

/* The admin page's promo form, the lobby's wardrobe wording and the client cosmetics catalog (mirrored from server/src/domain/economy/cosmetics.ts – the server's
   cosmetics.spec.ts compares the lists; here: every item has a look, junk never breaks the cockpit). */
const base = { code: ' welcome ', kind: 'free_rides', rides: '3', tier: '1h', credits: '1', poolId: '', slot: 'cabin', item: 'midnight', description: '  Hi ', start: '', end: '', max: '', perWallet: '', note: '' };

test('the form → a promo body: trimmed text, blank = none, per wallet defaults to 1', () => {
  assert.deepEqual(promoFromForm(base), { code: 'welcome', effect: { kind: 'free_rides', count: 3 }, description: 'Hi', maxRedemptions: null, perWallet: 1, startsAt: null, expiresAt: null, note: null });
  assert.deepEqual(promoFromForm({ ...base, kind: 'tickets', tier: '4h', credits: '2', poolId: '7', max: '50', perWallet: '2', note: ' vip ' }),
    { code: 'welcome', effect: { kind: 'tickets', tier: '4h', poolId: 7, credits: 2 }, description: 'Hi', maxRedemptions: 50, perWallet: 2, startsAt: null, expiresAt: null, note: 'vip' });
  assert.deepEqual(promoFromForm({ ...base, kind: 'cosmetic', slot: 'cabin', item: 'noir' }).effect, { kind: 'cosmetic', slot: 'cabin', item: 'noir' });
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
  for (const item of [COSMETICS.cabin[0], 'racing', '']) assert.throws(() => promoFromForm({ ...base, kind: 'cosmetic', slot: 'cabin', item }), /Pick an item/, item);
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

test('the client catalog: one slot (the cabin), every item has a palette with the same keys as the classic one and a name, the default is the first', () => {
  assert.deepEqual(SLOTS, ['cabin']);
  assert.ok(SLOT_NAME.cabin);
  assert.deepEqual(Object.keys(LOOKS.cabin), COSMETICS.cabin, 'LOOKS lists the same cabins in the same order');
  const shape = o => Object.entries(o).map(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? `${k}{${shape(v)}}` : k)).join(',');
  for (const item of COSMETICS.cabin) {
    assert.equal(shape(LOOKS.cabin[item]), shape(LOOKS.cabin.classic), `${item}: same palette keys`);
    assert.notEqual(itemName(item), undefined, item);
    for (const c of [...LOOKS.cabin[item].interior, ...LOOKS.cabin[item].dash, LOOKS.cabin[item].frame, LOOKS.cabin[item].hood.top, LOOKS.cabin[item].wheel.rim]) assert.match(c, /^#[0-9a-f]{6}$/i, `${item}: ${c}`);
  }
  const looks = COSMETICS.cabin.map(i => JSON.stringify(LOOKS.cabin[i]));
  assert.equal(new Set(looks).size, looks.length, 'no two cabins look the same');
  assert.deepEqual(defaultLoadout(), { cabin: 'classic' });
});

test('setLoadout keeps what is known and falls back to the default for junk (a hostile or stale server value cannot break the cockpit)', () => {
  setLoadout({ cabin: 'noir', seat: 'x' });
  assert.deepEqual({ ...loadout }, { cabin: 'noir' });
  assert.equal(look('cabin').wheel.sheen, LOOKS.cabin.noir.wheel.sheen);
  setLoadout({ cabin: '<script>' });
  assert.deepEqual({ ...loadout }, { cabin: 'classic' });
  setLoadout(null);
  assert.deepEqual({ ...loadout }, defaultLoadout());
});

test('the cockpit is the only place that draws cosmetics; the module stays a leaf (the landing\'s dash cards run the cockpit without three.js)', () => {
  const src = readFileSync(join(new URL('..', import.meta.url).pathname, '..', 'client', 'js', 'cosmetics.js'), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'no imports');
});
