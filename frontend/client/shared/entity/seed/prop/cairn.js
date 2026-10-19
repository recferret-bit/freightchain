export default {
  id: 'cairn', kind: 'prop', v: 1, label: 'cairn',
  note: 'three stacked stones',
  params: { s: { default: 1.2, min: 0.9, max: 1.5, note: 'size, m' } },
  slots: { m: { note: 'stone' } },
  debris: 'm',
  parts: [
    { for: ['w', 'hh', 'y'], in: [[1.3, 0.35, 0], [1, 0.3, 0.45], [0.7, 0.25, 0.78]], do: [
      { geo: 'rock', tag: 'stone', mat: 'm', s: ['s * w * 0.5', 's * hh', 's * w * 0.5'], at: [0, 's * y * 0.6', 0] },
    ] },
  ],
};
