// "BRAINROT" – a hard, fast A minor / phrygian loop for the quick-cut TikTok clip: kick four on the floor, a repeating 16th riff, snare rolls, and a full-bar riser at the end.
// Chords: Am Bb Am Gm | Am Bb Gm Am. Lead lines are [step (16ths), midi, length in steps].
const RIFF = [[0, 81, 1], [1, 81, 1], [2, 84, 1], [4, 81, 1], [5, 80, 1], [6, 81, 2], [8, 76, 1], [9, 76, 1], [10, 79, 1], [12, 76, 1], [13, 75, 1], [14, 76, 2]];
export default {
  id: 'brainrot', title: 'BRAINROT', bpm: 168, bars: 8,
  chords: [[45, 'm'], [46, 'M'], [45, 'm'], [43, 'm'], [45, 'm'], [46, 'M'], [43, 'm'], [45, 'm']],
  lead: [RIFF, RIFF.map(([a, m, l]) => [a, m + 1, l]), RIFF, RIFF.map(([a, m, l]) => [a, m - 2, l]), RIFF, RIFF.map(([a, m, l]) => [a, m + 1, l]), [[0, 79, 1], [1, 79, 1], [2, 82, 1], [4, 79, 1], [6, 82, 1], [8, 86, 1], [9, 86, 1], [10, 88, 1], [12, 91, 4]], [[0, 93, 16]]],
  turn: [[0, 93, 4], [4, 91, 2], [6, 88, 2], [8, 84, 2], [10, 88, 2], [12, 91, 4]],
  drums: (bar, s, { turn } = {}) => {
    if (bar === 7 && turn) return (s % 4 === 0 ? 'k' : '') + (s >= 8 ? 's' : s % 2 === 0 ? 'h' : '') + (s === 0 ? 'c' : '');
    if (bar === 7) return s === 0 ? 'kc' : s === 8 ? 'k' : '';
    let d = s % 4 === 0 ? 'k' : ''; if (s === 4 || s === 12) d += 's'; if (bar === 6 && s >= 8) d += 's'; d += s % 2 === 0 ? 'h' : s % 4 === 3 ? 'o' : ''; return d;
  },
};
