// "UNEASY" – a slow, hollow loop for the creepy "same tree again" clip: sparse long lead notes a tritone apart (A / Eb), a heartbeat kick on 1, no hats.
// Chords: Am Bbm Am Bbm | Fm Em Bbm Am. Lead lines are [step (16ths), midi, length in steps].
export default {
  id: 'uneasy', title: 'UNEASY', bpm: 72, bars: 8,
  chords: [[45, 'm'], [46, 'm'], [45, 'm'], [46, 'm'], [41, 'm'], [40, 'm'], [46, 'm'], [45, 'm']],
  lead: [[[0, 81, 12]], [[0, 80, 10], [10, 75, 6]], [[0, 81, 8], [8, 75, 8]], [[0, 82, 12]], [[0, 77, 10], [10, 80, 6]], [[0, 76, 8], [8, 71, 8]], [[0, 82, 6], [6, 81, 4], [10, 75, 6]], [[0, 69, 16]]],
  turn: [[0, 82, 6], [6, 81, 4], [10, 75, 6]],
  drums: (bar, s, { turn } = {}) => {
    if (bar === 7 && !turn) return s === 0 ? 'kc' : '';
    return s === 0 ? 'k' : s === 3 && bar % 2 ? 'k' : '';
  },
};
