// "BUS STOP" – a calm, slightly too cheerful C major loop for the "long ride" jokes: slow pulse, sparse lead, soft drums (kick on 1 and 3, a snare on 4 only).
// Chords: C Am F G | C Am F G. Lead lines are [step (16ths), midi, length in steps]; tempo is free (the mix fits 8 bars to the clip).
export default {
  id: 'bus-stop', title: 'BUS STOP', bpm: 92, bars: 8,
  chords: [[48, 'M'], [45, 'm'], [41, 'M'], [43, 'M'], [48, 'M'], [45, 'm'], [41, 'M'], [43, 'M']],
  lead: [
    [[0, 79, 4], [4, 76, 4], [8, 79, 6], [14, 81, 2]],
    [[0, 81, 4], [4, 76, 4], [8, 72, 8]],
    [[0, 77, 4], [4, 81, 4], [8, 84, 6], [14, 81, 2]],
    [[0, 79, 4], [4, 83, 4], [8, 79, 8]],
    [[0, 79, 4], [4, 84, 4], [8, 83, 4], [12, 79, 4]],
    [[0, 81, 4], [4, 79, 4], [8, 76, 4], [12, 72, 4]],
    [[0, 77, 4], [4, 81, 4], [8, 84, 4], [12, 86, 4]],
    [[0, 84, 16]],
  ],
  turn: [[0, 79, 6], [6, 83, 2], [8, 86, 4], [12, 83, 2], [14, 79, 2]],
  drums: (bar, s, { turn } = {}) => {
    if (bar === 7 && turn) return (s % 8 === 0 ? 'k' : '') + (s === 12 || s === 14 ? 's' : '') + (s === 0 ? 'c' : '');
    if (bar === 7) return s === 0 ? 'kc' : '';
    let d = ''; if (s === 0 || s === 8) d += 'k'; if (s === 12 && bar % 2) d += 's'; if (s % 4 === 2) d += 'h'; return d;
  },
};
