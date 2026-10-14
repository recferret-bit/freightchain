// The in-game sound effects: short one-shots for the real game (client/audio/sfx/), same chip voices and seeded recipes as the promo sounds, built by `node audio/cli.mjs game`.
// Each entry: { dur, vol, make() → Float32Array }. `vol` is the default playback gain the game uses (the recipes are normalised, the vol balances them against the engine and the radio).
import { make, voice, mtof, midi, fade, peak, gain } from './synth.mjs';

const tone = (b, t, d, n, o = {}) => voice(b, t, d, { wave: 'pulse', f: mtof(midi(n)), duty: .5, vol: .2, a: .002, d: d * .5, s: .6, r: d * .3, ...o });

export const GAME_SFX = {
  // ---- drivetrain
  shift:     { dur: .24, vol: .7, make: () => fade(make(.24, b => {                       // lever into gear: low thump + dry clunk
    voice(b, 0, .06, { wave: 'tri', f: t => 140 - 900 * t, vol: .6, a: .001, d: .05, s: 0, r: .01 });
    voice(b, 0, .02, { wave: 'white', lp: 3200, vol: .45, a: .0005, d: .015, s: 0, r: .006, seed: 7 });
    voice(b, .07, .05, { wave: 'lfsr', f: 6000, short: true, vol: .12, a: .0005, d: .03, s: 0, r: .01, seed: 8 });
  }), .001, .03) },
  grind:     { dur: .5, vol: .8, make: () => fade(make(.5, b => {                         // missed clutch: gears raking
    voice(b, 0, .5, { wave: 'lfsr', f: t => 900 + 500 * Math.sin(t * 90), short: true, vol: .4, a: .003, d: .3, s: .5, r: .15, seed: 21, crush: 6 });
    voice(b, 0, .5, { wave: 'white', hp: 800, lp: 4200, vol: .3, a: .004, d: .3, s: .4, r: .15, seed: 22 });
    voice(b, 0, .4, { wave: 'pulse', f: t => 95 + 25 * Math.sin(t * 70), duty: .25, vol: .2, a: .003, d: .3, s: .4, r: .1 });
  }), .001, .08) },
  key:       { dur: .2, vol: .7, make: () => fade(make(.2, b => {                         // key into the ignition + turned
    voice(b, 0, .012, { wave: 'white', hp: 1800, vol: .5, a: .0005, d: .01, s: 0, r: .004, seed: 3 });
    voice(b, .09, .016, { wave: 'white', hp: 1000, vol: .55, a: .0005, d: .012, s: 0, r: .004, seed: 4 });
    voice(b, .09, .05, { wave: 'pulse', f: 1400, duty: .25, vol: .14, a: .0005, d: .03, s: 0, r: .01 });
  }), .001, .03) },
  'engine-off': { dur: .5, vol: .6, make: () => fade(make(.5, b => {                      // shut-off shudder: a falling low note and a last clunk
    voice(b, 0, .45, { wave: 'tri', f: t => 78 * Math.exp(-t * 5) + 20, vol: .6, a: .003, d: .35, s: .2, r: .12 });
    voice(b, .3, .03, { wave: 'white', lp: 1800, vol: .3, a: .001, d: .02, s: 0, r: .008, seed: 9 });
  }), .001, .08) },
  park:      { dur: .45, vol: .7, make: () => fade(make(.45, b => {                       // handbrake ratchet: a run of clicks that slows down, then a thunk
    for (let i = 0, t = 0; i < 7; i++, t += .028 + i * .008) voice(b, t, .012, { wave: 'white', hp: 1400 + i * 120, vol: .38, a: .0004, d: .009, s: 0, r: .003, seed: 30 + i });
    voice(b, .3, .1, { wave: 'sine', f: t => 110 * Math.exp(-t * 14) + 45, vol: .55, a: .001, d: .08, s: 0, r: .02 });
  }), .001, .04) },
  'park-off': { dur: .3, vol: .7, make: () => fade(make(.3, b => {                         // release: pneumatic psst + clunk
    voice(b, 0, .02, { wave: 'sine', f: t => 140 * Math.exp(-t * 20) + 50, vol: .5, a: .001, d: .015, s: 0, r: .005 });
    voice(b, .03, .22, { wave: 'white', hp: 2500, vol: .16, a: .01, d: .1, s: .4, r: .09, seed: 31 });
  }), .001, .04) },

  // ---- dash and cab switches
  switch:    { dur: .08, vol: .6, make: () => fade(make(.08, b => {
    voice(b, 0, .008, { wave: 'white', hp: 1500, vol: .45, a: .0003, d: .007, s: 0, r: .003, seed: 15 });
    voice(b, .02, .02, { wave: 'pulse', f: 900, duty: .25, vol: .13, a: .0005, d: .014, s: 0, r: .004 });
  }), .0005, .015) },
  'switch-off': { dur: .08, vol: .6, make: () => fade(make(.08, b => {
    voice(b, 0, .008, { wave: 'white', hp: 1100, vol: .45, a: .0003, d: .007, s: 0, r: .003, seed: 16 });
    voice(b, .02, .02, { wave: 'pulse', f: 640, duty: .25, vol: .13, a: .0005, d: .014, s: 0, r: .004 });
  }), .0005, .015) },
  wiper:     { dur: .8, vol: .5, make: () => fade(make(.8, b => {                         // one back-and-forth sweep over the glass
    for (const t of [.02, .4]) { voice(b, t, .32, { wave: 'white', lp: 1900, hp: 450, vol: .22, a: .1, d: .1, s: .5, r: .1, seed: 16 }); voice(b, t + .32, .02, { wave: 'sine', f: 90, vol: .25, a: .001, d: .015, s: 0, r: .005 }); }
  }), .002, .06) },
  washer:    { dur: .6, vol: .45, make: () => fade(make(.6, b => {                        // spray hiss + pump whine
    voice(b, 0, .6, { wave: 'white', hp: 2200, vol: .18, a: .03, d: .1, s: .85, r: .08, seed: 17 });
    voice(b, 0, .6, { wave: 'pulse', f: 210, duty: .25, vol: .06, a: .02, d: .1, s: .8, r: .08 });
  }), .002, .08) },
  radio:     { dur: .35, vol: .5, make: () => fade(make(.35, b => {                       // tuning: a burst of static + a blip of tone
    voice(b, 0, .3, { wave: 'white', hp: 600, lp: 5000, vol: .22, a: .004, d: .15, s: .3, r: .1, seed: 40, crush: 5 });
    voice(b, .02, .12, { wave: 'pulse', f: t => 500 + 1800 * t, duty: .5, vol: .09, a: .003, d: .08, s: .3, r: .03 });
  }), .001, .06) },

  // ---- hits and damage
  bump:      { dur: .3, vol: .8, make: () => fade(make(.3, b => {                         // a light knock: nudged a post, brushed a car
    voice(b, 0, .25, { wave: 'sine', f: t => 120 * Math.exp(-t * 14) + 38, vol: .7, a: .001, d: .15, s: 0, r: .08 });
    voice(b, 0, .12, { wave: 'white', lp: 2200, vol: .4, a: .0005, d: .08, s: 0, r: .03, seed: 41 });
  }), .001, .05) },
  smash:     { dur: .55, vol: .85, make: () => fade(make(.55, b => {                      // a prop breaks: splintering crack + rubble
    voice(b, 0, .02, { wave: 'white', vol: .8, a: .0005, d: .015, s: 0, r: .004, seed: 42 });
    voice(b, 0, .45, { wave: 'white', lp: 3400, hp: 300, vol: .5, a: .001, d: .3, s: .1, r: .12, seed: 43, crush: 6 });
    voice(b, 0, .3, { wave: 'lfsr', f: t => 5200 * Math.exp(-t * 6) + 500, short: true, vol: .3, a: .001, d: .2, s: 0, r: .06, seed: 44 });
    voice(b, 0, .35, { wave: 'sine', f: t => 100 * Math.exp(-t * 8) + 35, vol: .6, a: .001, d: .25, s: 0, r: .08 });
  }), .001, .08) },
  crash:     { dur: 1.3, vol: 1, make: () => fade(make(1.3, b => {                        // the big one (same recipe as the trailer's crash)
    voice(b, 0, .02, { wave: 'white', vol: .9, a: .0005, d: .015, s: 0, r: .004, seed: 1 });
    voice(b, 0, 1.1, { wave: 'white', lp: 2600, vol: .8, a: .001, d: .9, s: .08, r: .25, seed: 2, crush: 6, hold: 2 });
    voice(b, 0, .6, { wave: 'lfsr', f: t => 9000 * Math.exp(-t * 3.2) + 600, short: true, vol: .4, a: .001, d: .5, s: 0, r: .1, seed: 3 });
    voice(b, 0, .8, { wave: 'sine', f: t => 130 * Math.exp(-t * 3.5) + 28, vol: .85, a: .001, d: .6, s: .1, r: .2 });
    for (const [t, f] of [[.06, 5200], [.12, 6400], [.2, 4800], [.31, 7000], [.45, 5600]]) voice(b, t, .08, { wave: 'pulse', f, duty: .125, vol: .08, a: .001, d: .06, s: 0, r: .02 });
  }), .001, .12) },
  scrape:    { dur: .6, vol: .6, make: () => fade(make(.6, b => {                         // paint on metal
    voice(b, 0, .6, { wave: 'white', hp: 1800, lp: 6500, vol: .3, a: .02, d: .3, s: .5, r: .2, seed: 45 });
    voice(b, 0, .6, { wave: 'lfsr', f: 2600, short: true, vol: .12, a: .02, d: .3, s: .5, r: .2, seed: 46 });
  }), .004, .12) },
  pothole:   { dur: .4, vol: .85, make: () => fade(make(.4, b => {                        // wheel drops into the pit: heavy thud + suspension rattle
    voice(b, 0, .3, { wave: 'sine', f: t => 90 * Math.exp(-t * 10) + 32, vol: .85, a: .001, d: .2, s: 0, r: .08 });
    voice(b, 0, .05, { wave: 'white', lp: 1500, vol: .5, a: .0005, d: .04, s: 0, r: .01, seed: 47 });
    for (const t of [.1, .17, .25]) voice(b, t, .04, { wave: 'pulse', f: 260 - t * 300, duty: .25, vol: .1, a: .001, d: .03, s: 0, r: .01 });
  }), .001, .06) },
  glass:     { dur: .45, vol: .6, make: () => fade(make(.45, b => {                       // the windscreen cracks: sharp tick + falling sparkle
    voice(b, 0, .01, { wave: 'white', hp: 3000, vol: .7, a: .0003, d: .008, s: 0, r: .003, seed: 48 });
    for (const [t, f] of [[.02, 6800], [.07, 5400], [.13, 7200], [.2, 4800], [.29, 6000]]) voice(b, t, .07, { wave: 'pulse', f, duty: .125, vol: .08, a: .001, d: .05, s: 0, r: .02 });
  }), .0005, .06) },

  // ---- warnings and state changes
  warn:      { dur: .4, vol: .55, make: () => fade(make(.4, b => { tone(b, 0, .12, 'E5', { duty: .25 }); tone(b, .18, .12, 'E5', { duty: .25 }); tone(b, .18, .2, 'A4', { vol: .12 }); }), .001, .06) },
  alarm:     { dur: .7, vol: .6, make: () => fade(make(.7, b => { for (let i = 0; i < 4; i++) tone(b, i * .17, .12, i % 2 ? 'C5' : 'G5', { duty: .25, vol: .22 }); }), .001, .06) },
  stall:     { dur: .6, vol: .7, make: () => fade(make(.6, b => {                         // the engine dies: low falling note + a clank
    voice(b, 0, .55, { wave: 'tri', f: t => 95 * Math.exp(-t * 4.5) + 22, vol: .6, a: .002, d: .4, s: .1, r: .12 });
    voice(b, .02, .08, { wave: 'white', lp: 1400, vol: .35, a: .001, d: .05, s: 0, r: .02, seed: 49 });
  }), .001, .1) },
  complete:  { dur: 1.2, vol: .6, make: () => fade(make(1.2, b => {                        // shift complete: a bright arpeggio and a held chord
    ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => tone(b, i * .1, .14, n, { duty: .25, vol: .2 }));
    for (const [n, v] of [['C5', .16], ['E5', .14], ['G5', .16]]) tone(b, .42, .7, n, { vol: v, d: .2, s: .6, r: .35 });
    voice(b, .42, .7, { wave: 'tri', f: mtof(midi('C3')), vol: .28, a: .002, d: .2, s: .8, r: .3 });
  }), .001, .15) },
  'game-over': { dur: 1.35, vol: .7, make: () => fade(make(1.35, b => {
    [[0, 'E5', .16], [.17, 'C5', .16], [.34, 'A4', .16], [.51, 'E4', .16], [.74, 'A3', .6]].forEach(([t, n, d], i) => {
      tone(b, t, d, n, { duty: i < 4 ? .5 : .25, vol: i < 4 ? .3 : .34, vib: i === 4 ? { rate: 5, depth: .35, delay: .15 } : undefined });
      voice(b, t, d, { wave: 'tri', f: mtof(midi(n) - 12), vol: .26, a: .002, d: .05, s: .8, r: .08 });
    });
  }), .001, .1) },
  start:     { dur: .35, vol: .5, make: () => fade(make(.35, b => { tone(b, 0, .1, 'A4', { duty: .25 }); tone(b, .09, .2, 'E5', { duty: .25 }); }), .001, .06) },
  ui:        { dur: .06, vol: .45, make: () => fade(make(.06, b => tone(b, 0, .05, 'A5', { duty: .5, vol: .2, d: .02, s: .3, r: .02 })), .001, .01) },
};
// 0.8, not 0.9: lame at 40 kb/s overshoots, and 0.9 PCM decoded past full scale on the transients (smash, pothole).
for (const s of Object.values(GAME_SFX)) { const raw = s.make; s.make = () => { const b = raw(), p = peak(b); return p > .8 ? gain(b, .8 / p) : b; }; }
export const GAME_SFX_IDS = Object.keys(GAME_SFX);

