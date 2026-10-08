// "ROAD RUSH" – 8 bars of Master System / Mega Drive driving chiptune in A minor (the cab radio's PIXEL RALLY station is the same family: square lead, triangle bass, noise drums).
// 32 beats; tempo is free (the mix fits it to the clip: 8 bars end exactly when the video does). Lead lines are [step (16ths), midi, length in steps]. Chords: Am F C G | Am F G Am.
export default {
  id: 'road-rush', title: 'ROAD RUSH', bpm: 136, bars: 8,
  chords: [[45, 'm'], [41, 'M'], [48, 'M'], [43, 'M'], [45, 'm'], [41, 'M'], [43, 'M'], [45, 'm']],   // [root midi (bass octave), quality]
  lead: [
    [[0, 81, 2], [2, 76, 2], [4, 81, 2], [6, 76, 2], [8, 84, 4], [12, 83, 2], [14, 81, 2]],
    [[0, 77, 2], [2, 72, 2], [4, 77, 2], [6, 72, 2], [8, 81, 4], [12, 79, 2], [14, 77, 2]],
    [[0, 76, 2], [2, 79, 2], [4, 84, 4], [8, 79, 2], [10, 76, 2], [12, 79, 4]],
    [[0, 79, 2], [2, 83, 2], [4, 86, 4], [8, 83, 2], [10, 79, 2], [12, 74, 2], [14, 79, 2]],
    [[0, 81, 2], [2, 84, 2], [4, 88, 4], [8, 84, 2], [10, 81, 2], [12, 76, 4]],
    [[0, 77, 2], [2, 81, 2], [4, 84, 4], [8, 81, 2], [10, 77, 2], [12, 72, 4]],
    [[0, 79, 2], [2, 83, 2], [4, 86, 2], [6, 83, 2], [8, 86, 2], [10, 88, 2], [12, 91, 4]],
    [[0, 93, 16]],
  ],
  drums: (bar, s) => {   // 'k' kick · 's' snare · 'h' hat · 'o' open hat · 'c' crash
    if (bar === 7) return s === 0 ? 'kc' : s === 8 ? 'k' : '';
    let d = ''; if (s % 8 === 0 || (s === 6 && bar % 2) || s === 10) d += 'k';
    if (bar > 0 && (s === 4 || s === 12)) d += 's'; if (bar === 6 && s >= 8 && s % 2 === 0) d += 's';   // snare roll into the last bar
    if (s % 2 === 0) d += s === 14 ? 'o' : 'h'; return d;
  },
};
