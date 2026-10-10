import test from 'node:test';
import assert from 'node:assert/strict';
import { STATIONS, makeSong, radioEvents, savedIndex } from '../js/sim/radio.js';

const at = genre => STATIONS.findIndex(s => s.genre === genre);
const song = genre => makeSong(at(genre), 0);
const fifth = 2 ** (7 / 12);

test('eleven instrumental stations, in dial order, one of each new genre', () => {
  assert.equal(STATIONS.length, 11);
  const genres = STATIONS.map(s => s.genre);
  for (const id of ['country', 'honky', 'metal', 'forge', 'rock', 'pop', 'jazz', 'synth', 'blues', 'lofi', 'chip']) assert.ok(genres.includes(id), id);
  assert.equal(new Set(genres).size, genres.length);
  assert.equal(new Set(STATIONS.map(s => s.freq)).size, 11);
  assert.equal(new Set(STATIONS.map(s => s.seed)).size, 11);
  assert.deepEqual(STATIONS.map(s => s.freq), [...STATIONS.map(s => s.freq)].sort((a, b) => a - b));
  for (const s of STATIONS) assert.ok(s.short.length <= 5 && s.freq > 88 && s.freq < 108, s.name);
});

test('an old saved index still tunes the same station', () => {
  assert.equal(STATIONS[savedIndex({ idx: 0 })].name, 'DUSTY ROAD');
  assert.equal(STATIONS[savedIndex({ idx: 1 })].name, 'NEON HIGHWAY');
  assert.equal(STATIONS[savedIndex({ idx: 2 })].name, 'MIDNIGHT 66');
  assert.equal(STATIONS[savedIndex({ idx: 3 })].name, 'LOFI TRUCKSTOP');
  assert.equal(STATIONS[savedIndex({ idx: 4 })].name, 'PIXEL RALLY');
  assert.equal(STATIONS[savedIndex({ name: 'IRON HAUL', idx: 0 })].name, 'IRON HAUL');
  assert.equal(STATIONS[savedIndex({ name: 'SWING SHIFT', idx: 4 })].name, 'SWING SHIFT');
});

test('the older stations keep their first song', () => {
  const want = {
    synth: { root: 45, prog: [0, 0, 5, 4], title: 'Silver Signal Line', head: [null, null, null, null, 4, null, 5, null, null, null, null, null, 6, 5, null, null] },
    blues: { root: 45, prog: [0, 0, 0, 0], title: 'Empty Moon', head: [null, null, 2, null, null, null, null, null, null, null, null, null, 0, 0, null, null] },
    chip: { root: 57, prog: [0, 4, 5, 3], title: 'Burning Dust Blues', head: [3, 2, 1, null, 2, null, 2, null, 2, null, 2, 1, 1, null, 3, 1] },
  };
  for (const [genre, w] of Object.entries(want)) {
    const sg = song(genre);
    assert.equal(sg.root, w.root, genre);
    assert.deepEqual(sg.prog, w.prog, genre);
    assert.equal(sg.title, w.title, genre);
    assert.deepEqual(sg.mel[4], w.head, genre);   // bar 4 is the first bar with a lead
    assert.equal(sg.G.pad.mode, genre === 'blues' ? 'hold' : 'arp');
    assert.equal(sg.G.bass.mode, genre === 'blues' ? 'walk' : 'pulse8');
  }
  assert.equal(song('lofi').G.bass.mode, 'lazy');
  assert.equal(song('blues').walk, null);   // the desert-blues walk stays the fixed one
});

test('each slot is a different instrumental song, and the same slot never changes', () => {
  for (const [si, S] of STATIONS.entries()) {
    const a = makeSong(si, 0), b = makeSong(si, 1);
    assert.equal(JSON.stringify(a), JSON.stringify(makeSong(si, 0)), S.name);
    assert.notEqual(JSON.stringify(a.mel), JSON.stringify(b.mel), S.name);
    assert.ok(a.title && !a.title.includes('\n') && a.mel.length === 32, S.name);
    for (let step = 0; step < 64; step++) for (const e of radioEvents(a, step)) {
      if (e.drum) assert.ok('kshorex'.includes(e.drum), e.drum);
      else assert.ok(e.f > 20 && e.f < 5000 && e.o.vol > 0, S.genre + ' ' + e.f);
    }
  }
});

test('metal, rock and pop hooks repeat a cell', () => {
  for (const genre of ['metal', 'forge', 'rock']) {
    let repeated = 0;
    for (let slot = 0; slot < 6; slot++) {
      const bar = makeSong(at(genre), slot).mel.find(Boolean);
      if (JSON.stringify(bar.slice(0, 4)) === JSON.stringify(bar.slice(4, 8))) repeated++;
    }
    assert.equal(repeated, 6, genre);
  }
  for (let slot = 0; slot < 4; slot++) {
    const bar = makeSong(at('pop'), slot).mel.find(Boolean);
    assert.deepEqual(bar.slice(0, 8), bar.slice(8, 16));
  }
});

test('metal chugs a low fifth, classic metal gallops, rock hits the backbeat', () => {
  const metal = song('metal');
  assert.equal(metal.hit[0], 2);
  const fs = [...new Set(radioEvents(metal, 0).filter(e => e.f).map(e => e.f))].sort((a, b) => a - b);
  assert.ok(fs[0] < 120, fs[0]);
  assert.ok(fs.some((f, i) => fs.slice(i + 1).some(g => Math.abs(g / f - fifth) < .02)), fs.join(','));
  assert.ok(radioEvents(metal, 0).some(e => e.drum === 'k'));
  assert.ok(radioEvents(metal, 4).some(e => e.drum === 's'));
  const forge = song('forge');
  let gallops = 0;
  for (let b = 0; b < 4; b++) {
    const sub = [0, 1, 2, 3].map(k => forge.hit[b * 4 + k]);
    if (sub[0] === 2 && sub[1] === 0 && sub[2] > 0 && sub[3] > 0) gallops++;
  }
  assert.equal(gallops, 3);
  const rock = song('rock');
  assert.equal(rock.hit[0], 2);
  assert.ok(rock.hit.every((v, i) => i % 2 === 0 || v === 0));
  assert.ok(radioEvents(rock, 4).some(e => e.drum === 's'));
  assert.ok(radioEvents(rock, 14).some(e => e.drum === 'o'));
  assert.notEqual(JSON.stringify(metal.hit), JSON.stringify(makeSong(at('metal'), 1).hit));
});

test('country is boom-chick, honky-tonk shuffles, pop is four on the floor, jazz swings a ride', () => {
  const country = song('country');
  const low = e => e.f && e.f < 200, high = e => e.f && e.f > 200;
  assert.ok(radioEvents(country, 0).some(e => e.drum === 'k') && radioEvents(country, 0).some(low));
  assert.equal(radioEvents(country, 0).filter(high).length, 0);
  assert.ok(radioEvents(country, 4).filter(high).length >= 3);
  assert.ok(radioEvents(country, 4).some(e => e.drum === 's'));
  const hat = radioEvents(song('honky'), 2).find(e => e.drum === 'h');
  assert.ok(hat && hat.sw > 0, 'the shuffle delays the off-beat');
  for (const s of [0, 4, 8, 12]) assert.ok(radioEvents(song('pop'), s).some(e => e.drum === 'k'), 'pop ' + s);
  const down = radioEvents(song('jazz'), 0), off = radioEvents(song('jazz'), 2);
  assert.ok(down.some(e => e.drum === 'r' && e.sw === 0));
  assert.ok(off.some(e => e.drum === 'r' && e.sw > 0));
  assert.ok(down.filter(e => e.f).length >= 4);   // the stabbed seventh chord, not a single beep
  assert.equal(song('jazz').walk.length, 4);
});
