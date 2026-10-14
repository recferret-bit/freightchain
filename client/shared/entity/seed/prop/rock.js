export default {
  id: 'rock', kind: 'prop', v: 1, label: 'rock',
  params: { s: { default: 1.4, min: 0.5, max: 2.8, note: 'radius, m' }, r2: { default: 0.5, min: 0, max: 1, note: 'picks the material and the spin' } },
  slots: { m1: { note: 'stone' }, m2: { note: 'second stone', default: 'm1' } },
  debris: ['m1', 'm2'],
  parts: [
    { geo: 'rock', tag: 'rock', mat: { if: 'r2 > 0.5', then: 'm1', else: 'm2' }, s: ['s * 1.3', 's * 0.8', 's'], at: [0, 's * 0.35', 0], rot: [0, 'r2 * 6', 0] },
  ],
};
