// Sound effects: every recipe is a function (opts) → Float32Array, built from the synth's chip voices and seeded, so it renders the same every time.
// `SFX[id].dur` = the default length (opts.dur overrides where the recipe stretches). Used by the cue builder (cues.mjs) for a clip and by the store (cli.mjs store) for the library.
import { make, voice, mtof, midi, fade, clamp, peak, gain } from './synth.mjs';

export const SFX = {
  // KEY + ENGINE ON (0.5 – 0.9 s): key into the ignition (metal tick-tick), the starter grinding, the engine catching with a rev flare and falling to idle.
  ignition: { dur: .8, make(o = {}) {
    const D = clamp(o.dur ?? .8, .5, .9), b = make(D, b => {   // the whole sound is exactly D long (0.5 – 0.9 s): the engine's catch + first idle beats are inside it
      voice(b, 0, .012, { wave: 'white', hp: 1800, vol: .55, a: .0005, d: .01, s: 0, r: .004, seed: 3 });            // key tick
      voice(b, 0, .02, { wave: 'pulse', f: 2400, duty: .125, vol: .16, a: .0005, d: .015, s: 0, r: .004 });
      voice(b, .075, .014, { wave: 'white', hp: 1200, vol: .5, a: .0005, d: .012, s: 0, r: .004, seed: 4 });         // turn: the second, lower clack
      voice(b, .075, .03, { wave: 'pulse', f: 1500, duty: .25, vol: .14, a: .0005, d: .02, s: 0, r: .006 });
      const c0 = .13, c1 = D - .38;                                                                                  // starter: ragged chug that speeds up
      for (let t = c0, k = 0; t < c1; k++) { const per = .075 - .028 * (t - c0) / (c1 - c0); voice(b, t, per * .62, { wave: 'pulse', f: 62 + 28 * (t - c0) / (c1 - c0), duty: .25, vol: .3, a: .002, d: per * .4, s: .25, r: .012, lp: 900 }); voice(b, t, per * .45, { wave: 'lfsr', f: 1900, short: true, vol: .09, a: .001, d: per * .3, s: 0, r: .01, seed: k + 5 }); t += per; }
      const e0 = c1;                                                                                                // catch: a rev flare, then idle lope
      voice(b, e0, .38, { wave: 'pulse', f: t => t < .12 ? 55 + 520 * (t / .12) ** .7 : 575 * Math.exp(-(t - .12) * 4.2) + 62, duty: t => .12 + .3 * clamp(t / .3), vol: .3, a: .004, d: .1, s: .6, r: .1, lp: 3200 });
      voice(b, e0, .38, { wave: 'lfsr', f: t => 5000 + 2500 * Math.exp(-t * 9), vol: .17, a: .002, d: .12, s: .35, r: .1, lp: 2400, seed: 31 });
      for (let t = e0 + .16, k = 0; t < D - .06; k++) { voice(b, t, .05, { wave: 'tri', f: 64 - k, vol: .26, a: .002, d: .035, s: 0, r: .01 }); t += .095; }
    }); return fade(b, .001, .05); } },

  // gear lever: clutch thump + dry clunk + a tiny rising blip (the "shift" tick of arcade racers)
  shift: { dur: .22, make(o = {}) { const g = o.gain ?? 1; return fade(make(.22, b => {
    voice(b, 0, .05, { wave: 'tri', f: t => 150 - 1200 * t, vol: .5 * g, a: .001, d: .045, s: 0, r: .01 });
    voice(b, 0, .02, { wave: 'white', lp: 3000, vol: .4 * g, a: .0005, d: .015, s: 0, r: .006, seed: 7 });
    voice(b, .045, .03, { wave: 'lfsr', f: 7000, short: true, vol: .13 * g, a: .0005, d: .02, s: 0, r: .006, seed: 8 });
    voice(b, .07, .06, { wave: 'pulse', f: t => 520 + 700 * (t / .06), duty: .25, vol: .1 * g, a: .002, d: .05, s: 0, r: .01 });
  }), .001, .03); } },

  // the crash: sub-drop + a long low-passed noise sweep + metal crunch (short-mode LFSR) + glass sparkle, crushed to 6 bit for the Mega-Drive grit
  crash: { dur: 1.3, make(o = {}) { return fade(make(1.3, b => {
    voice(b, 0, .02, { wave: 'white', vol: .9, a: .0005, d: .015, s: 0, r: .004, seed: 1 });
    voice(b, 0, 1.1, { wave: 'white', lp: 2600, vol: .8, a: .001, d: .9, s: .08, r: .25, seed: 2, crush: 6, hold: 2 });
    voice(b, 0, .6, { wave: 'lfsr', f: t => 9000 * Math.exp(-t * 3.2) + 600, short: true, vol: .4, a: .001, d: .5, s: 0, r: .1, seed: 3 });
    voice(b, 0, .8, { wave: 'sine', f: t => 130 * Math.exp(-t * 3.5) + 28, vol: .85, a: .001, d: .6, s: .1, r: .2 });
    voice(b, .03, .5, { wave: 'pulse', f: t => 190 * Math.exp(-t * 2) + 60, duty: .125, vol: .26, a: .001, d: .4, s: 0, r: .1, crush: 5 });
    for (const [t, f] of [[.06, 5200], [.12, 6400], [.2, 4800], [.31, 7000], [.45, 5600]]) voice(b, t, .08, { wave: 'pulse', f, duty: .125, vol: .08, a: .001, d: .06, s: 0, r: .02 });   // glass
  }), .001, .12); } },

  // "SHIFT OVER" – the descending game-over phrase every Sega game has: four square notes down, a low final one
  'game-over': { dur: 1.35, make() { return fade(make(1.35, b => {
    [[0, 'E5', .16], [.17, 'C5', .16], [.34, 'A4', .16], [.51, 'E4', .16], [.74, 'A3', .6]].forEach(([t, n, d], i) => {
      voice(b, t, d, { wave: 'pulse', f: mtof(midi(n)), duty: i < 4 ? .5 : .25, vol: i < 4 ? .3 : .34, a: .002, d: .06, s: .7, r: .08, vib: i === 4 ? { rate: 5, depth: .35, delay: .15 } : undefined });
      voice(b, t, d, { wave: 'tri', f: mtof(midi(n) - 12), vol: .26, a: .002, d: .05, s: .8, r: .08 });
    });
  }), .001, .1); } },

  // transitions, one per type; `dur` stretches them to the transition's length (the peak is in the middle, where the cut is hidden)
  'tr-flash': { dur: .4, make(o = {}) { const D = o.dur ?? .4; return fade(make(D, b => {   // laser zap up into a noise burst on the cut
    voice(b, 0, D * .5, { wave: 'pulse', f: t => 220 * 2 ** (t / (D * .5) * 3.6), duty: .25, vol: .24, a: .002, d: D * .45, s: .3, r: .02 });
    voice(b, D * .46, D * .54, { wave: 'white', lp: 6000, vol: .5, a: .001, d: D * .5, s: 0, r: .02, seed: 11 });
    voice(b, D * .46, D * .4, { wave: 'pulse', f: t => 1800 * Math.exp(-t * 7) + 150, duty: .5, vol: .2, a: .001, d: D * .3, s: 0, r: .02 });
  }), .001, .02); } },
  'tr-flash-red': { dur: .4, make(o = {}) { const D = o.dur ?? .4; return fade(make(D, b => {
    voice(b, 0, D, { wave: 'pulse', f: t => 140 + 40 * Math.sin(t * 60), duty: .5, vol: .24, a: .002, d: D * .8, s: .4, r: .05, crush: 4 });
    voice(b, D * .45, D * .55, { wave: 'white', lp: 3000, vol: .5, a: .001, d: D * .5, s: 0, r: .03, seed: 12 });
  }), .001, .03); } },
  'tr-whip': { dur: .3, make(o = {}) { const D = o.dur ?? .3; return fade(make(D, b => {    // swept noise "whoosh": opens, passes the cut, closes
    for (let i = 0; i < 6; i++) voice(b, i * D / 6, D / 6 * 1.4, { wave: 'white', hp: 300 + 900 * Math.sin(Math.PI * i / 5.2), lp: 1200 + 5200 * Math.sin(Math.PI * (i + .5) / 6), vol: .24 * Math.sin(Math.PI * (i + .6) / 6.4) + .04, a: D / 14, d: D / 6, s: .8, r: D / 14, seed: 20 + i });
    voice(b, D * .3, D * .5, { wave: 'tri', f: t => 330 * 2 ** (-t / (D * .5) * 1.5), vol: .14, a: .01, d: D * .4, s: 0, r: .03 });
  }), .004, .04); } },
  'tr-glitch': { dur: .4, make(o = {}) { const D = o.dur ?? .4; return fade(make(D, b => {   // stuttering sample-and-hold blips, bit-crushed, like a bad cartridge
    for (let i = 0, t = 0; t < D; i++) { const s = 17 * (i + 3), per = .018 + .02 * ((s * 37 % 11) / 11); voice(b, t, per, { wave: i % 3 ? 'pulse' : 'lfsr', f: i % 3 ? 180 + (s * 53 % 1900) : 4000 + (s * 31 % 9000), short: true, duty: .125 * (1 + i % 4), vol: .26, a: .0005, d: per * .8, s: .3, r: .003, crush: 3 + i % 3, hold: 1 + i % 4, seed: i + 40 }); t += per * (.8 + (i % 3) * .3); }
  }), .001, .02); } },
  'tr-zoom': { dur: .4, make(o = {}) { const D = o.dur ?? .4; return fade(make(D, b => {     // rising riser, then a bright sparkle on the cut
    voice(b, 0, D * .55, { wave: 'pulse', f: t => 180 * 2 ** (t / (D * .55) * 3.2), duty: t => .125 + .375 * clamp(t / (D * .55)), vol: .26, a: .01, d: D * .5, s: .8, r: .02 });
    voice(b, 0, D * .55, { wave: 'white', hp: 1500, lp: 7000, vol: .13, a: D * .3, d: D * .2, s: .8, r: .02, seed: 13 });
    for (const [t, n] of [[D * .5, 'E6'], [D * .58, 'A6'], [D * .66, 'E7']]) voice(b, t, .07, { wave: 'pulse', f: mtof(midi(n)), duty: .25, vol: .1, a: .001, d: .05, s: 0, r: .03 });
  }), .001, .03); } },
  'tr-dip': { dur: .4, make(o = {}) { const D = o.dur ?? .4; return fade(make(D, b => { voice(b, 0, D, { wave: 'tri', f: t => 440 * 2 ** (-t / D * 2.2), vol: .3, a: .01, d: D * .8, s: .2, r: .05 }); }), .001, .05); } },

  // captions: a menu "select" beep when a headline slams in, a soft typewriter tick per few letters, a thump for the big one-word look
  caption: { dur: .16, make() { return fade(make(.16, b => { for (const [t, n] of [[0, 'A5'], [.065, 'E6']]) voice(b, t, .06, { wave: 'pulse', f: mtof(midi(n)), duty: .5, vol: .17, a: .001, d: .04, s: .6, r: .03 }); }), .001, .03); } },
  tick: { dur: .03, make() { return fade(make(.03, b => voice(b, 0, .012, { wave: 'pulse', f: 1500, duty: .25, vol: .07, a: .0005, d: .01, s: 0, r: .004 })), .0005, .008); } },
  slam: { dur: .35, make() { return fade(make(.35, b => { voice(b, 0, .3, { wave: 'sine', f: t => 160 * Math.exp(-t * 9) + 40, vol: .7, a: .001, d: .22, s: 0, r: .06 }); voice(b, 0, .05, { wave: 'white', lp: 4000, vol: .35, a: .0005, d: .04, s: 0, r: .01, seed: 14 }); }), .001, .05); } },

  // dash switches
  click: { dur: .07, make(o = {}) { const lo = o.low ? .75 : 1; return fade(make(.07, b => { voice(b, 0, .008, { wave: 'white', hp: 1500 * lo, vol: .4, a: .0003, d: .007, s: 0, r: .003, seed: 15 }); voice(b, .018, .018, { wave: 'pulse', f: 1100 * lo, duty: .25, vol: .16, a: .0005, d: .014, s: 0, r: .005 }); }), .0005, .01); } },
  wiper: { dur: .85, make() { return fade(make(.85, b => { for (const t of [.02, .43]) { voice(b, t, .3, { wave: 'white', lp: 1800, hp: 400, vol: .22, a: .09, d: .1, s: .5, r: .1, seed: 16 }); voice(b, t + .3, .02, { wave: 'tri', f: 120, vol: .22, a: .001, d: .015, s: 0, r: .006 }); } }), .002, .05); } },
  washer: { dur: .6, make(o = {}) { const D = o.dur ?? .6; return fade(make(D, b => { voice(b, 0, D, { wave: 'white', hp: 2200, vol: .16, a: .03, d: .1, s: .85, r: .08, seed: 17 }); for (let t = 0; t < D; t += .045) voice(b, t, .02, { wave: 'lfsr', f: 9000, short: true, vol: .05, a: .001, d: .015, s: 0, r: .004, seed: 18 + (t * 100 | 0) }); }), .005, .08); } },

  // end card: ascending arpeggio, then the CTA hit (full chord + sparkle)
  card: { dur: .8, make() { return fade(make(.8, b => {
    ['A4', 'C5', 'E5', 'A5'].forEach((n, i) => voice(b, i * .09, .12, { wave: 'pulse', f: mtof(midi(n)), duty: .25, vol: .2, a: .002, d: .06, s: .5, r: .05 }));
    for (const [n, v] of [['A4', .17], ['E5', .15], ['A5', .17], ['C6', .12]]) voice(b, .4, .38, { wave: 'pulse', f: mtof(midi(n)), duty: .5, vol: v, a: .002, d: .1, s: .6, r: .2 });
    voice(b, .4, .38, { wave: 'tri', f: mtof(midi('A2')), vol: .3, a: .002, d: .1, s: .8, r: .2 }); voice(b, .4, .04, { wave: 'white', lp: 6000, vol: .3, a: .0005, d: .03, s: 0, r: .01, seed: 19 });
  }), .001, .1); } },
};
// A recipe sums many voices: scale a sound that would clip (> 0.9) down so the stored WAV and the mix never clip; quieter sounds keep their relative level.
for (const s of Object.values(SFX)) { const raw = s.make; s.make = (o = {}) => { const b = raw(o), p = peak(b); return p > .9 ? gain(b, .9 / p) : b; }; }
export const SFX_IDS = Object.keys(SFX);
