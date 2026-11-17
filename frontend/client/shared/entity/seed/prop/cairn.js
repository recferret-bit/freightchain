export default {
  id: 'cairn', kind: 'prop', v: 1, label: 'cairn',
  note: 'Atacama trail cairn: five flat balanced desert stones stacked from ground level upward',
  params: { s: { default: 1.2, min: 0.9, max: 1.5, note: 'size, m' } },
  slots: { m: { note: 'stone' } },
  debris: 'm',
  parts: [
    { for: ['w', 'hh', 'y', 'ry'], in: [[1.35, 0.22, 0.2, 0.2], [1.08, 0.19, 0.56, 0.9], [0.84, 0.17, 0.88, 1.7], [0.62, 0.15, 1.16, 2.5], [0.42, 0.13, 1.4, 0.5]], do: [
      { geo: 'rock', tag: 'stone', mat: 'm', s: ['s * w * 0.48', 's * hh', 's * w * 0.44'], at: [0, 's * y', 0], rot: [0, 'ry', 0] },
    ] },
  ],
};
