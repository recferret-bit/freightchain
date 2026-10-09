import test from 'node:test';
import assert from 'node:assert/strict';
import { pad, sol, km, left, dur, short, hue, hours, driven, ago, plural, TIER, TIER_LONG, ROUTE } from '../src/format.js';

test('pad: two digits, floors fractions', () => { assert.equal(pad(5), '05'); assert.equal(pad(12.9), '12'); assert.equal(pad(0), '00'); });

test('sol: lamports → SOL, 3 decimals below 1 SOL, 2 above', () => {
  assert.equal(sol(0), '0.000'); assert.equal(sol(123_456_789), '0.123'); assert.equal(sol(1e9), '1.00'); assert.equal(sol(12_345_678_901), '12.35');
});

test('km: precision shrinks as the number grows', () => {
  assert.equal(km(0), '0.00'); assert.equal(km(1234), '1.23'); assert.equal(km(54_321), '54.3'); assert.equal(km(2_500_000), '2500');
});

test('left: countdown with days only when needed, never negative', () => {
  assert.equal(left(0), '00:00:00'); assert.equal(left(-5000), '00:00:00'); assert.equal(left(61_000), '00:01:01');
  assert.equal(left(3_661_000), '01:01:01'); assert.equal(left(90_000_000), '1d 01:00:00');
});

test('dur: m:ss under an hour, h:mm:ss over, clamps and rounds', () => {
  assert.equal(dur(0), '0:00'); assert.equal(dur(59.6), '1:00'); assert.equal(dur(754), '12:34'); assert.equal(dur(3600), '1:00:00'); assert.equal(dur(-3), '0:00');
});

test('short: first and last four characters of a wallet', () => { assert.equal(short('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'), '7xKX…gAsU'); });

test('hue: stable and inside the colour wheel', () => {
  const w = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  assert.equal(hue(w), hue(w)); assert.ok(hue(w) >= 0 && hue(w) < 360); assert.notEqual(hue('aaaa'), hue('aaab'));
});

test('driven: seconds below a minute, minutes below an hour, then hours with one decimal', () => { assert.equal(driven(0), '0 s'); assert.equal(driven(19.4), '19 s'); assert.equal(driven(630), '11 min'); assert.equal(driven(3600), '1.0 h'); assert.equal(driven(37_800), '10.5 h'); });
test('hours: minutes below an hour, whole hours above', () => { assert.equal(hours(300), '5 min'); assert.equal(hours(1800), '30 min'); assert.equal(hours(3600), '1 h'); assert.equal(hours(28_800), '8 h'); });

test('ago: coarse relative time', () => {
  assert.equal(ago(0), 'just now'); assert.equal(ago(59_000), 'just now'); assert.equal(ago(120_000), '2 min ago'); assert.equal(ago(7_200_000), '2 h ago'); assert.equal(ago(172_800_000), '2 d ago'); assert.equal(ago(-1000), 'just now');
});

test('plural: one vs many, irregular plurals', () => {
  assert.equal(plural(1, 'ride'), '1 ride'); assert.equal(plural(0, 'ride'), '0 rides'); assert.equal(plural(2, 'paid entry', 'paid entries'), '2 paid entries'); assert.equal(plural(1, 'paid entry', 'paid entries'), '1 paid entry');
});

test('label tables cover every tier and route the server can send', () => {
  for (const t of ['free', '1h', '4h', '8h']) { assert.ok(TIER[t]); assert.ok(TIER_LONG[t]); }
  for (const r of ['route66', 'stuart', 'siberia', 'brenner', 'panamerican']) assert.ok(ROUTE[r]);
});
