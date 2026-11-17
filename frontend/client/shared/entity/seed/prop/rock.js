export default {
  id: 'rock', kind: 'prop', v: 1, label: 'rock',
  note: 'weathered roadside boulder outcrop: primary crag, secondary shoulder stone & basal talus',
  params: { s: { default: 1.4, min: 0.5, max: 2.8, note: 'radius, m' }, r2: { default: 0.5, min: 0, max: 1, note: 'picks the material and the spin' } },
  slots: { m1: { note: 'stone' }, m2: { note: 'second stone', default: 'm1' } },
  debris: ['m1', 'm2'],
  parts: [
    { group: {}, rot: [0, 'r2 * 6', 0], do: [
      { geo: 'rock', tag: 'rock', mat: { if: 'r2 > 0.5', then: 'm1', else: 'm2' }, s: ['s * 1.15', 's * 0.68', 's * 0.92'], at: [0, 's * 0.64', 0] },
      { geo: 'rock', tag: 'rock', mat: { if: 'r2 > 0.5', then: 'm2', else: 'm1' }, s: ['s * 0.68', 's * 0.46', 's * 0.62'], at: ['s * 0.68', 's * 0.44', 's * 0.24'] },
      { geo: 'rock', tag: 'talus', mat: 'm1', s: ['s * 0.46', 's * 0.3', 's * 0.44'], at: ['-s * 0.62', 's * 0.28', '-s * 0.28'] },
    ] },
  ],
};
